import XCTest
@testable import ProofPhotosCompanion

@MainActor private final class FakeLoginService: LoginItemService {
    var state: LoginItemState = .disabled
    var registrations = 0
    var removals = 0
    var fail = false
    func register() throws {
        registrations += 1
        if fail { throw NSError(domain: "synthetic", code: 1) }
        state = .requiresApproval
    }
    func unregister() throws {
        removals += 1
        if fail { throw NSError(domain: "synthetic", code: 2) }
        state = .disabled
    }
}

final class LoginItemControllerTests: XCTestCase {
    @MainActor func testStartupAndRefreshNeverRegister() {
        let service = FakeLoginService()
        let controller = LoginItemController(service: service)
        controller.refresh()
        XCTAssertEqual(service.registrations, 0)
        XCTAssertEqual(service.removals, 0)
        service.state = .enabled
        controller.refresh()
        XCTAssertEqual(controller.state, .enabled)
        service.state = .disabled
        controller.refresh()
        XCTAssertEqual(controller.state, .disabled)
    }

    @MainActor func testExplicitActionUsesActualOSStateAndFailureDoesNotInventSuccess() {
        let service = FakeLoginService()
        let controller = LoginItemController(service: service)
        controller.setEnabled(true)
        XCTAssertEqual(controller.state, .requiresApproval)
        XCTAssertEqual(service.registrations, 1)
        service.state = .enabled
        service.fail = true
        controller.setEnabled(false)
        XCTAssertTrue(controller.actionFailed)
        XCTAssertEqual(controller.state, .enabled)
        service.fail = false
        controller.setEnabled(false)
        XCTAssertFalse(controller.actionFailed)
        XCTAssertEqual(controller.state, .disabled)
    }
}
