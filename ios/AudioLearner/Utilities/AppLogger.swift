import Foundation
import os

/// Централизованное логирование (спека §15.2).
enum AppLogger {
    private static let subsystem = "com.victor.audiolearner"

    static let importer = Logger(subsystem: subsystem, category: "import")
    static let player = Logger(subsystem: subsystem, category: "player")
    static let data = Logger(subsystem: subsystem, category: "data")
    static let general = Logger(subsystem: subsystem, category: "general")
}
