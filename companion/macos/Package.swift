// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ProofPhotosCompanion",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "ProofPhotosCompanion", targets: ["ProofPhotosCompanion"])],
    targets: [
        .target(name: "CompanionCore"),
        .target(name: "CompanionVision", dependencies: ["CompanionCore"]),
        .executableTarget(name: "ProofPhotosCompanion", dependencies: ["CompanionCore", "CompanionVision"]),
        .testTarget(name: "CompanionCoreTests", dependencies: ["CompanionCore"]),
        .testTarget(name: "CompanionVisionTests", dependencies: ["CompanionVision"]),
    ],
    swiftLanguageModes: [.v5]
)
