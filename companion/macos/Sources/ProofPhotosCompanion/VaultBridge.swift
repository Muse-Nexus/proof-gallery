import Foundation
import Network
import CompanionCore
import CompanionVault

/// Long-lived only while the owner-enabled companion runs. Every request uses
/// its own persisted, revocable grant; the port is not an authorization secret.
final class VaultBridge: @unchecked Sendable {
    private let queue = DispatchQueue(label: "proof.vault-loopback")
    private let service: VaultService
    private var listener: NWListener?
    private var connections: [UUID: NWConnection] = [:]
    private var tasks: [UUID: Task<Void, Never>] = [:]
    private var authorizedRequests: [UUID: VaultBridgeRequest] = [:]
    private var session = UUID()
    private var port: UInt16 = 0
    private var windowStart = DispatchTime.now().uptimeNanoseconds
    private var requestCount = 0
    init(vault: ProofVault) { service = VaultService(vault: vault) }
    func start(preferredPort: UInt16 = 0, ready: @escaping @Sendable (UInt16?) -> Void) {
        queue.async {
            self.stopOnQueue(); let session = self.session
            do {
                let parameters = NWParameters(tls: nil, tcp: NWProtocolTCP.Options())
                let endpointPort = NWEndpoint.Port(rawValue: preferredPort) ?? .any
                parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: endpointPort)
                let listener = try NWListener(using: parameters, on: endpointPort)
                self.listener = listener
                listener.newConnectionHandler = { [weak self] connection in self?.accept(connection, session: session) }
                listener.stateUpdateHandler = { [weak self] state in
                    guard let self, self.session == session else { return }
                    switch state {
                    case .ready:
                        guard let port = listener.port, port.rawValue >= 1024 else { self.stopOnQueue(); ready(nil); return }
                        self.port = port.rawValue; ready(self.port)
                    case .failed: self.stopOnQueue(); ready(nil)
                    default: break
                    }
                }
                listener.start(queue: self.queue)
            } catch { self.stopOnQueue(); ready(nil) }
        }
    }
    func stop() { queue.async { self.stopOnQueue() } }
    private func stopOnQueue() {
        session = UUID(); listener?.cancel(); listener = nil; port = 0
        for task in tasks.values { task.cancel() }; tasks.removeAll()
        for connection in connections.values { connection.cancel() }; connections.removeAll()
        authorizedRequests.removeAll()
    }
    private func finish(_ id: UUID) {
        tasks.removeValue(forKey: id)?.cancel()
        authorizedRequests.removeValue(forKey: id)
        connections.removeValue(forKey: id)?.cancel()
    }
    private func accept(_ connection: NWConnection, session: UUID) {
        guard self.session == session, connections.count < 2 else { connection.cancel(); return }
        let now = DispatchTime.now().uptimeNanoseconds
        if now - windowStart >= 60_000_000_000 { windowStart = now; requestCount = 0 }
        guard requestCount < 240 else { connection.cancel(); return }
        requestCount += 1
        let id = UUID(); connections[id] = connection
        connection.stateUpdateHandler = { [weak self] state in
            if case .failed = state { self?.finish(id) }
            if case .cancelled = state { self?.finish(id) }
        }
        connection.start(queue: queue)
        queue.asyncAfter(deadline: .now() + 10) { [weak self] in
            guard let self, self.session == session, self.tasks[id] == nil else { return }; self.finish(id)
        }
        queue.asyncAfter(deadline: .now() + 30) { [weak self] in
            guard let self, self.session == session else { return }; self.finish(id)
        }
        receive(id, session: session, buffer: Data(), request: nil)
    }
    private func receive(_ id: UUID, session: UUID, buffer: Data, request: VaultBridgeRequest?) {
        guard self.session == session, let connection = connections[id] else { return }
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] bytes, _, complete, error in
            guard let self, self.session == session, self.connections[id] != nil else { return }
            guard error == nil, let bytes, !bytes.isEmpty else { self.finish(id); return }
            var buffer = buffer; buffer.append(bytes); var request = request
            if request == nil {
                guard let end = buffer.range(of: Data("\r\n\r\n".utf8)) else {
                    if buffer.count > 8192 || complete { self.finish(id) }
                    else { self.receive(id, session: session, buffer: buffer, request: nil) }; return
                }
                do {
                    request = try VaultBridgeRequest.parse(buffer.subdata(in: 0..<end.upperBound), port: self.port)
                    if let request, !request.preflight {
                        try self.service.authorize(request); self.authorizedRequests[id] = request
                    }
                } catch { self.respond(id, session: session, status: "403 Forbidden", data: Data(), cors: request?.gallery == true); return }
                buffer.removeSubrange(0..<end.upperBound)
            }
            guard let request, buffer.count <= request.length else { self.finish(id); return }
            if buffer.count == request.length { self.handle(id, session: session, request: request, body: buffer) }
            else if complete { self.finish(id) }
            else { self.receive(id, session: session, buffer: buffer, request: request) }
        }
    }
    private func handle(_ id: UUID, session: UUID, request: VaultBridgeRequest, body: Data) {
        if request.preflight { respond(id, session: session, status: "204 No Content", data: Data(), cors: true); return }
        connections[id]?.receive(minimumIncompleteLength: 1, maximumLength: 1) { [weak self] _, _, _, _ in
            guard let self, self.session == session else { return }; self.finish(id)
        }
        tasks[id] = Task { [weak self] in
            guard let self else { return }
            do {
                let data = try await self.service.handle(request, body: body)
                guard data.count <= 14 * 1024 * 1024 else { throw VaultError.capacity }
                try Task.checkCancellation()
                self.queue.async {
                    guard self.session == session else { return }
                    // A revoked/expired connection cannot release queued bytes.
                    do { try self.service.authorize(request); self.respond(id, session: session, status: "200 OK", data: data, cors: request.gallery) }
                    catch { self.respond(id, session: session, status: "403 Forbidden", data: Data(), cors: request.gallery) }
                }
            } catch {
                let status: String
                switch error {
                case VaultError.forbidden: status = "403 Forbidden"
                case VaultError.staleRevision: status = "409 Conflict"
                case VaultError.capacity: status = "413 Content Too Large"
                default: status = "422 Unprocessable Content"
                }
                self.queue.async { if self.session == session { self.respond(id, session: session, status: status, data: Data(), cors: request.gallery) } }
            }
        }
    }
    private func respond(_ id: UUID, session: UUID, status: String, data: Data, cors: Bool) {
        guard self.session == session, let connection = connections[id] else { return }
        let corsHeaders = cors ? "Access-Control-Allow-Origin: \(VaultBridgeRequest.origin)\r\nAccess-Control-Allow-Methods: POST\r\nAccess-Control-Allow-Headers: Authorization, Content-Type\r\nAccess-Control-Allow-Private-Network: true\r\nVary: Origin\r\n" : ""
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
        if let request = authorizedRequests[id] {
            do { try service.authorize(request) }
            catch { finish(id); return }
        }
        let end = min(offset + 64 * 1024, data.count)
        connection.send(content: data.subdata(in: offset..<end), completion: .contentProcessed { [weak self] error in
            guard let self, self.session == session else { return }
            if error != nil { self.finish(id); return }
            self.sendBody(id, session: session, data: data, offset: end)
        })
    }
}
