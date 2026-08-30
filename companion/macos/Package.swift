// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ProofPhotosCompanion",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "ProofPhotosCompanion", targets: ["ProofPhotosCompanion"])],
    targets: [
        .target(name: "CompanionCore"),
        .executableTarget(name: "ProofPhotosCompanion", dependencies: ["CompanionCore"]),
        .testTarget(name: "CompanionCoreTests", dependencies: ["CompanionCore"]),
    ],
    swiftLanguageModes: [.v5]
)
