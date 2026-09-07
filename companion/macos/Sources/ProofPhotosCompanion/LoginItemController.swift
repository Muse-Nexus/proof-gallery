import Foundation
import ServiceManagement

enum LoginItemState: Equatable {
    case enabled, disabled, requiresApproval, unavailable
}

@MainActor protocol LoginItemService {
    var state: LoginItemState { get }
    func register() throws
    func unregister() throws
}

@MainActor struct SystemLoginItemService: LoginItemService {
    var state: LoginItemState {
        switch SMAppService.mainApp.status {
        case .enabled: return .enabled
        case .notRegistered: return .disabled
        case .requiresApproval: return .requiresApproval
        case .notFound: return .unavailable
        @unknown default: return .unavailable
        }
    }
    func register() throws { try SMAppService.mainApp.register() }
    func unregister() throws { try SMAppService.mainApp.unregister() }
}

/// OS status is authoritative. Constructing/refreshing never registers anything.
/// Wire setEnabled only to the owner's separate launch-at-login action.
@MainActor final class LoginItemController: ObservableObject {
    @Published private(set) var state: LoginItemState
    @Published private(set) var actionFailed = false
    private let service: any LoginItemService

    init(service: any LoginItemService) {
        self.service = service
        self.state = service.state
    }

    func refresh() { state = service.state }

    func setEnabled(_ enabled: Bool) {
        actionFailed = false
        do {
            if enabled { try service.register() }
            else { try service.unregister() }
        } catch {
            // Do not expose OS diagnostics that might include private paths.
            actionFailed = true
        }
        refresh()
    }
}
