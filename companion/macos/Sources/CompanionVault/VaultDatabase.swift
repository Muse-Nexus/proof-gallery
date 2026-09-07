import Foundation
import Darwin
import CSQLite

enum SQLValue { case text(String), blob(Data), integer(Int64), null }

/// A lifetime file lock ensures only the running companion owns this authority.
/// SQLite data and rollback journal live under a checked 0700 directory.
final class VaultDatabase {
    private var db: OpaquePointer?
    private var lockFD: Int32 = -1
    init(directory: URL) throws {
        guard directory.isFileURL, directory.path.hasPrefix("/"), !directory.pathComponents.contains("..") else { throw VaultError.unsafePath }
        var ancestor = URL(fileURLWithPath: "/", isDirectory: true)
        for component in directory.pathComponents.dropFirst() {
            ancestor.appendPathComponent(component)
            var info = stat()
            if lstat(ancestor.path, &info) == 0 {
                guard (info.st_mode & S_IFMT) == S_IFDIR else { throw VaultError.unsafePath }
            } else if ancestor.path != directory.path || errno != ENOENT { throw VaultError.unsafePath }
        }
        if !FileManager.default.fileExists(atPath: directory.path) {
            guard mkdir(directory.path, 0o700) == 0 else { throw VaultError.unsafePath }
        }
        var info = stat()
        guard lstat(directory.path, &info) == 0, info.st_uid == getuid(), info.st_mode & 0o777 == 0o700 else { throw VaultError.unsafePath }
        func safeFile(_ name: String) throws -> Int32 {
            let path = directory.appendingPathComponent(name).path
            let fd = open(path, O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC, 0o600)
            guard fd >= 0 else { throw VaultError.unsafePath }
            var s = stat()
            guard fstat(fd, &s) == 0, s.st_uid == getuid(), s.st_mode & S_IFMT == S_IFREG,
                  s.st_mode & 0o777 == 0o600, s.st_nlink == 1 else { close(fd); throw VaultError.unsafePath }
            return fd
        }
        lockFD = try safeFile("vault.lock")
        guard flock(lockFD, LOCK_EX | LOCK_NB) == 0 else { close(lockFD); lockFD = -1; throw VaultError.unavailable }
        do {
            let fd = try safeFile("vault.sqlite"); close(fd)
            // Reject sidecar substitution before SQLite's recovery logic can touch it.
            for name in ["vault.sqlite-journal", "vault.sqlite-wal", "vault.sqlite-shm"] {
                let path = directory.appendingPathComponent(name).path
                var s = stat()
                if lstat(path, &s) == 0 {
                    guard s.st_uid == getuid(), s.st_mode & S_IFMT == S_IFREG,
                          s.st_mode & 0o777 == 0o600, s.st_nlink == 1 else { throw VaultError.unsafePath }
                } else if errno != ENOENT { throw VaultError.unsafePath }
            }
            guard sqlite3_open_v2(directory.appendingPathComponent("vault.sqlite").path, &db,
                                  SQLITE_OPEN_READWRITE | SQLITE_OPEN_NOMUTEX, nil) == SQLITE_OK else { throw VaultError.storage }
            sqlite3_busy_timeout(db, 1000)
            let tables = try rows("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
                .compactMap { row in row.first.flatMap { $0 }.flatMap { String(data: $0, encoding: .utf8) } }
            if !tables.isEmpty {
                guard Set(tables) == Set(["metadata", "records", "sources", "handled", "tombstones", "clients", "reminder", "deliveries"]),
                      let version = try rows("SELECT value FROM metadata WHERE key='version'").first?.first ?? nil,
                      String(data: version, encoding: .utf8) == "1" else { throw VaultError.unavailable }
            }
            try run("PRAGMA foreign_keys=ON"); try run("PRAGMA trusted_schema=OFF")
            try run("PRAGMA journal_mode=DELETE"); try run("PRAGMA synchronous=FULL"); try run("PRAGMA secure_delete=ON")
        } catch {
            if let db { sqlite3_close(db); self.db = nil }
            flock(lockFD, LOCK_UN); close(lockFD); lockFD = -1
            throw error
        }
    }
    deinit { if let db { sqlite3_close(db) }; if lockFD >= 0 { flock(lockFD, LOCK_UN); close(lockFD) } }
    /// The caller must include identity metadata and these tables in one transaction.
    func initializeSchema() throws {
        guard sqlite3_get_autocommit(db) == 0 else { throw VaultError.storage }
        try run("CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        try run("CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, state TEXT NOT NULL, record BLOB NOT NULL, media BLOB)")
        try run("CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, body BLOB NOT NULL)")
        try run("CREATE TABLE IF NOT EXISTS handled (source_id TEXT NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(source_id,digest))")
        try run("CREATE TABLE IF NOT EXISTS tombstones (digest TEXT PRIMARY KEY)")
        try run("CREATE TABLE IF NOT EXISTS clients (id TEXT PRIMARY KEY, hash TEXT UNIQUE NOT NULL, body BLOB NOT NULL)")
        try run("CREATE TABLE IF NOT EXISTS reminder (id TEXT PRIMARY KEY, revision TEXT NOT NULL, body BLOB NOT NULL)")
        try run("CREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY, consent_revision TEXT NOT NULL, claimed_at TEXT NOT NULL)")
    }
    private func statement(_ sql: String, _ values: [SQLValue]) throws -> OpaquePointer {
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK, let stmt else { throw VaultError.storage }
        let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
        for (offset, value) in values.enumerated() {
            let i = Int32(offset + 1), result: Int32
            switch value {
            case .text(let v): result = v.withCString { sqlite3_bind_text(stmt, i, $0, -1, transient) }
            case .blob(let v): result = v.withUnsafeBytes { sqlite3_bind_blob(stmt, i, $0.baseAddress, Int32(v.count), transient) }
            case .integer(let v): result = sqlite3_bind_int64(stmt, i, v)
            case .null: result = sqlite3_bind_null(stmt, i)
            }
            guard result == SQLITE_OK else { sqlite3_finalize(stmt); throw VaultError.storage }
        }
        return stmt
    }
    func run(_ sql: String, _ values: [SQLValue] = []) throws {
        let stmt = try statement(sql, values); defer { sqlite3_finalize(stmt) }
        var result = sqlite3_step(stmt)
        while result == SQLITE_ROW { result = sqlite3_step(stmt) }
        guard result == SQLITE_DONE else { throw VaultError.storage }
    }
    func rows(_ sql: String, _ values: [SQLValue] = []) throws -> [[Data?]] {
        let stmt = try statement(sql, values); defer { sqlite3_finalize(stmt) }
        var result: [[Data?]] = []
        while true {
            let step = sqlite3_step(stmt)
            if step == SQLITE_DONE { return result }
            guard step == SQLITE_ROW else { throw VaultError.storage }
            result.append((0..<sqlite3_column_count(stmt)).map { i in
                if sqlite3_column_type(stmt, i) == SQLITE_NULL { return nil }
                let n = Int(sqlite3_column_bytes(stmt, i))
                guard let bytes = sqlite3_column_blob(stmt, i) else { return Data() }
                return Data(bytes: bytes, count: n)
            })
        }
    }
}
