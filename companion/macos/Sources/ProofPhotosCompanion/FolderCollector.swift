import Foundation
import Darwin
import ImageIO
import UniformTypeIdentifiers
import CompanionCore

struct FolderCandidate: Sendable {
    let filename: String
    let data: Data
    let mimeType: String
    let sha256: String
    // No filename/mtime-derived occurred date. Vault adds exact source receipt.
}

enum FolderReadError: Error { case unavailable, changed, invalidImage, tooLarge, enumerationLimit }

enum FolderCollector {
    static let enumerationLimit = 200

    static func bookmark(for url: URL) throws -> Data {
        try url.bookmarkData(options: [.withSecurityScope, .securityScopeAllowOnlyReadAccess],
                             includingResourceValuesForKeys: nil, relativeTo: nil)
    }

    static func scan(bookmark: Data, isHandled: (String) throws -> Bool = { _ in false }, receive: (FolderCandidate) async throws -> Void) async throws {
        var stale = false
        let url = try URL(resolvingBookmarkData: bookmark,
                          options: [.withSecurityScope, .withoutUI, .withoutMounting],
                          relativeTo: nil, bookmarkDataIsStale: &stale)
        guard !stale, url.startAccessingSecurityScopedResource() else { throw FolderReadError.unavailable }
        defer { url.stopAccessingSecurityScopedResource() }
        try await scan(directory: url, isHandled: isHandled, receive: receive)
    }

    // Internal entry point permits synthetic fixture tests without OS grants.
    static func scan(directory: URL, isHandled: (String) throws -> Bool = { _ in false }, receive: (FolderCandidate) async throws -> Void) async throws {
        let values = try directory.resourceValues(forKeys: [.volumeIsLocalKey, .isSymbolicLinkKey, .isAliasFileKey, .isUbiquitousItemKey])
        guard values.volumeIsLocal == true, values.isSymbolicLink != true,
              values.isAliasFile != true, values.isUbiquitousItem != true else { throw FolderReadError.unavailable }
        let fd = open(directory.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { throw FolderReadError.unavailable }
        guard let stream = fdopendir(fd) else { close(fd); throw FolderReadError.unavailable }
        defer { closedir(stream) }
        var names: [String] = []
        var count = 0
        while let entry = readdir(stream) {
            try Task.checkCancellation()
            let name = withUnsafePointer(to: &entry.pointee.d_name) {
                $0.withMemoryRebound(to: CChar.self, capacity: Int(MAXNAMLEN) + 1) { String(cString: $0) }
            }
            if name == "." || name == ".." { continue }
            count += 1
            guard count <= enumerationLimit else { throw FolderReadError.enumerationLimit }
            if !name.hasPrefix(".") { names.append(name) }
        }
        var retainedBytes = 0
        var accepted = 0
        for name in names.sorted() {
            try Task.checkCancellation()
            guard accepted < ReviewLimits.photoCount else { return }
            let itemURL = directory.appendingPathComponent(name)
            guard let values = try? itemURL.resourceValues(forKeys: [.isAliasFileKey, .isUbiquitousItemKey]),
                  values.isAliasFile != true, values.isUbiquitousItem != true else { continue }
            guard let item = try? read(parent: fd, name: name) else { continue }
            try Task.checkCancellation()
            if try isHandled(item.sha256) { continue }
            guard retainedBytes + item.data.count <= ReviewLimits.packageBytes else { return }
            try await receive(item)
            retainedBytes += item.data.count; accepted += 1
        }
    }

    private static func read(parent: Int32, name: String) throws -> FolderCandidate {
        var before = stat()
        guard fstatat(parent, name, &before, AT_SYMLINK_NOFOLLOW) == 0,
              before.st_mode & S_IFMT == S_IFREG,
              before.st_flags & UInt32(SF_DATALESS) == 0 else { throw FolderReadError.unavailable }
        guard before.st_size > 0, before.st_size <= ReviewLimits.photoBytes else { throw FolderReadError.tooLarge }
        let file = openat(parent, name, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)
        guard file >= 0 else { throw FolderReadError.unavailable }
        defer { close(file) }
        var opened = stat()
        guard fstat(file, &opened) == 0, same(before, opened),
              opened.st_flags & UInt32(SF_DATALESS) == 0 else { throw FolderReadError.changed }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 64 * 1024)
        while true {
            try Task.checkCancellation()
            let amount = Darwin.read(file, &buffer, buffer.count)
            if amount == 0 { break }
            guard amount > 0 else { throw FolderReadError.unavailable }
            guard data.count + amount <= ReviewLimits.photoBytes else { throw FolderReadError.tooLarge }
            data.append(contentsOf: buffer.prefix(amount))
        }
        var after = stat()
        guard fstat(file, &after) == 0, same(opened, after), data.count == after.st_size else { throw FolderReadError.changed }
        guard let image = CGImageSourceCreateWithData(data as CFData, nil),
              CGImageSourceGetCount(image) > 0,
              let rawType = CGImageSourceGetType(image),
              let mime = UTType(rawType as String)?.preferredMIMEType,
              ["image/jpeg", "image/png", "image/gif", "image/webp"].contains(mime) else { throw FolderReadError.invalidImage }
        return FolderCandidate(filename: name, data: data, mimeType: mime, sha256: digest(data))
    }

    private static func same(_ a: stat, _ b: stat) -> Bool {
        a.st_dev == b.st_dev && a.st_ino == b.st_ino && a.st_mode == b.st_mode &&
        a.st_size == b.st_size && a.st_mtimespec.tv_sec == b.st_mtimespec.tv_sec &&
        a.st_mtimespec.tv_nsec == b.st_mtimespec.tv_nsec &&
        a.st_ctimespec.tv_sec == b.st_ctimespec.tv_sec && a.st_ctimespec.tv_nsec == b.st_ctimespec.tv_nsec
    }
}
