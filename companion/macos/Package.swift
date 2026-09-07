// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ProofPhotosCompanion",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "ProofPhotosCompanion", targets: ["ProofPhotosCompanion"]),
        .executable(name: "ProofMCP", targets: ["ProofMCP"]),
    ],
    targets: [
        .systemLibrary(name: "CSQLite"),
        .target(name: "CompanionCore"),
        .target(name: "CompanionVault", dependencies: ["CompanionCore", "CSQLite"]),
        .target(name: "CompanionVision", dependencies: ["CompanionCore"]),
        .target(name: "CompanionIntelligence", dependencies: ["CompanionCore"]),
        .executableTarget(name: "ProofMCP", dependencies: ["CompanionCore"]),
        .executableTarget(name: "ProofPhotosCompanion", dependencies: ["CompanionCore", "CompanionVision", "CompanionIntelligence", "CompanionVault"]),
        .testTarget(name: "CompanionVaultTests", dependencies: ["CompanionVault", "CompanionCore"]),
        .testTarget(name: "CompanionCoreTests", dependencies: ["CompanionCore"]),
        .testTarget(name: "CompanionVisionTests", dependencies: ["CompanionVision"]),
        .testTarget(name: "CompanionIntelligenceTests", dependencies: ["CompanionIntelligence"]),
        .testTarget(name: "CompanionBridgeTests", dependencies: ["ProofPhotosCompanion"]),
    ],
    swiftLanguageModes: [.v5]
)
