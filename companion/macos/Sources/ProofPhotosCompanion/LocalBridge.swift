import Foundation
import Network
import Security
import CompanionCore
import CompanionIntelligence

/// Explicit, five-minute same-Mac session. No internet client, Photos commands, or disk writes.
final class LocalBridge: @unchecked Sendable {
    private let queue = DispatchQueue(label: "proof.loopback")
    private let intelligence = EvidenceIntelligence()
    private var listener: NWListener?
    private var connections: [UUID: NWConnection] = [:]
    private var tasks: [UUID: Task<Void, Never>] = [:]
    private var reading = Set<UUID>()
    private var session = UUID()
    private var token = ""
    private var port: UInt16 = 0
    private var review: Data?
    private let origin = "https://proof-gallery-9jn.pages.dev"

    func start(review: Data?, ready: @escaping @Sendable (String?) -> Void) {
        queue.async {
            self.stopOnQueue(); let session = self.session
            var random = [UInt8](repeating: 0, count: 32)
            guard SecRandomCopyBytes(kSecRandomDefault, random.count, &random) == errSecSuccess else { ready(nil); return }
            self.token = random.map { String(format: "%02x", $0) }.joined()
            self.review = review
            do {
                let parameters = NWParameters(tls: nil, tcp: NWProtocolTCP.Options())
                parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: .any)
                let listener = try NWListener(using: parameters, on: .any)
                self.listener = listener
                listener.newConnectionHandler = { [weak self] connection in self?.accept(connection, session: session) }
                listener.stateUpdateHandler = { [weak self] state in
                    guard let self, self.session == session else { return }
                    switch state {
                    case .ready:
                        guard let port = listener.port else { self.stopOnQueue(); ready(nil); return }
                        self.port = port.rawValue; ready("\(self.port).\(self.token)")
                    case .failed: self.stopOnQueue(); ready(nil)
                    default: break
                    }
                }
                listener.start(queue: self.queue)
                self.queue.asyncAfter(deadline: .now() + 300) { [weak self] in
                    guard let self, self.session == session else { return }; self.stopOnQueue(); ready(nil)
                }
            } catch { self.stopOnQueue(); ready(nil) }
        }
    }
    func stop() { queue.async { self.stopOnQueue() } }
    private func stopOnQueue() {
        session = UUID(); listener?.cancel(); listener = nil; token = ""; review = nil
        for task in tasks.values { task.cancel() }; tasks.removeAll()
        for connection in connections.values { connection.cancel() }; connections.removeAll()
        reading.removeAll()
    }
    private func finish(_ id: UUID) {
        reading.remove(id)
        tasks.removeValue(forKey: id)?.cancel()
        connections.removeValue(forKey: id)?.cancel()
    }
    private func accept(_ connection: NWConnection, session: UUID) {
        guard self.session == session, connections.count < 8 else { connection.cancel(); return }
        let id = UUID(); connections[id] = connection; reading.insert(id)
        connection.stateUpdateHandler = { [weak self] state in
            if case .failed = state { self?.finish(id) }
            if case .cancelled = state { self?.finish(id) }
        }
        connection.start(queue: queue)
        // Header/body deadlines also bound idle and slow request clients.
        queue.asyncAfter(deadline: .now() + 10) { [weak self] in
            guard let self, self.session == session, self.reading.contains(id) else { return }; self.finish(id)
        }
        receive(id, session: session, buffer: Data(), request: nil)
    }
    private func receive(_ id: UUID, session: UUID, buffer: Data, request: BridgeRequest?) {
        guard self.session == session, let connection = connections[id] else { return }
        connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { [weak self] bytes, _, complete, error in
            guard let self, self.session == session, self.connections[id] != nil else { return }
            guard error == nil, let bytes, !bytes.isEmpty else { self.finish(id); return }
            var buffer = buffer; buffer.append(bytes)
            var request = request
            if request == nil {
                guard let end = buffer.range(of: Data("\r\n\r\n".utf8)) else {
                    if buffer.count > 8192 || complete { self.finish(id) } else { self.receive(id, session: session, buffer: buffer, request: nil) }; return
                }
                do { request = try BridgeRequest.parse(buffer.subdata(in: 0..<end.upperBound), port: self.port, token: self.token, origin: self.origin) }
                catch { self.respond(id, session: session, status: "403 Forbidden", data: Data(), cors: false); return }
                buffer.removeSubrange(0..<end.upperBound)
            }
            guard let request, buffer.count <= request.length else { self.finish(id); return }
            if buffer.count == request.length { self.handle(id, session: session, request: request, body: buffer) }
            else if complete { self.finish(id) }
            else { self.receive(id, session: session, buffer: buffer, request: request) }
        }
    }
    private func handle(_ id: UUID, session: UUID, request: BridgeRequest, body: Data) {
        reading.remove(id)
        queue.asyncAfter(deadline: .now() + 60) { [weak self] in
            guard let self, self.session == session else { return }; self.finish(id)
        }
        // Observe disconnect/cancel while computing; reject pipelining/extra bytes.
        connections[id]?.receive(minimumIncompleteLength: 1, maximumLength: 1) { [weak self] _, _, _, _ in
            guard let self, self.session == session else { return }
            self.finish(id)
        }
        if request.preflight { respond(id, session: session, status: "204 No Content", data: Data()); return }
        if request.path == "/v1/review" {
            guard let review else { respond(id, session: session, status: "409 Conflict", data: Data()); return }
            self.review = nil // One download; originals/prepared native batch are never removed.
            respond(id, session: session, status: "200 OK", data: review); return
        }
        tasks[id] = Task { [weak self] in
            guard let self else { return }
            do {
                let data: Data
                if request.path == "/v1/capabilities" { data = try JSONEncoder().encode(await self.intelligence.capabilities()) }
                else {
                    let input = try JSONDecoder().decode(EvidenceRequest.self, from: body)
                    let result = request.path == "/v1/search" ? try await self.intelligence.search(input) : try await self.intelligence.story(input)
                    data = try JSONEncoder().encode(result)
                }
                try Task.checkCancellation()
                self.queue.async { if self.session == session { self.respond(id, session: session, status: "200 OK", data: data) } }
            } catch {
                self.queue.async { if self.session == session { self.respond(id, session: session, status: "422 Unprocessable Content", data: Data()) } }
            }
        }
    }
    private func respond(_ id: UUID, session: UUID, status: String, data: Data, cors: Bool = true) {
        guard self.session == session, let connection = connections[id] else { return }
        let corsHeaders = cors ? "Access-Control-Allow-Origin: \(origin)\r\nAccess-Control-Allow-Methods: GET, POST\r\nAccess-Control-Allow-Headers: Authorization, Content-Type\r\nAccess-Control-Allow-Private-Network: true\r\nVary: Origin\r\n" : ""
        let header = Data("HTTP/1.1 \(status)\r\nContent-Length: \(data.count)\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\(corsHeaders)\r\n".utf8)
        connection.send(content: header, completion: .contentProcessed { [weak self] error in
            guard let self, self.session == session else { return }
            if error != nil { self.finish(id); return }
            self.sendBody(id, session: session, data: data, offset: 0)
        })
    }
    private func sendBody(_ id: UUID, session: UUID, data: Data, offset: Int) {
        guard self.session == session, let connection = connections[id] else { return }
        guard offset < data.count else { finish(id); return }
        let end = min(offset + 64 * 1024, data.count)
        connection.send(content: data.subdata(in: offset..<end), completion: .contentProcessed { [weak self] error in
            guard let self, self.session == session else { return }
            if error != nil { self.finish(id); return }
            self.sendBody(id, session: session, data: data, offset: end)
        })
    }
}
