// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ProofPhotosCompanion",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "ProofPhotosCompanion", targets: ["ProofPhotosCompanion"])],
    targets: [
        .target(name: "CompanionCore"),
        .target(name: "CompanionVision", dependencies: ["CompanionCore"]),
        .target(name: "CompanionIntelligence", dependencies: ["CompanionCore"]),
        .executableTarget(name: "ProofPhotosCompanion", dependencies: ["CompanionCore", "CompanionVision", "CompanionIntelligence"]),
        .testTarget(name: "CompanionCoreTests", dependencies: ["CompanionCore"]),
        .testTarget(name: "CompanionVisionTests", dependencies: ["CompanionVision"]),
        .testTarget(name: "CompanionIntelligenceTests", dependencies: ["CompanionIntelligence"]),
        .testTarget(name: "CompanionBridgeTests", dependencies: ["ProofPhotosCompanion"]),
    ],
    swiftLanguageModes: [.v5]
)
