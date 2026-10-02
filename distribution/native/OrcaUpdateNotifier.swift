import AppKit
import Foundation
import UserNotifications

// A stable, separate bundle sends completion notices while Orca is closed.
// It never opens/quits Orca or handles user project files.
let application = NSApplication.shared
application.setActivationPolicy(.prohibited)
let center = UNUserNotificationCenter.current()
let arguments = Array(CommandLine.arguments.dropFirst())
var finished = false

func value(_ flag: String) -> String? {
    guard let index = arguments.firstIndex(of: flag), index + 1 < arguments.count else { return nil }
    return arguments[index + 1]
}

func finish(_ result: [String: Any]) {
    let bytes = try! JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
    FileHandle.standardOutput.write(bytes)
    FileHandle.standardOutput.write(Data("\n".utf8))
    finished = true
    CFRunLoopStop(CFRunLoopGetMain())
}

func perform(_ settings: UNNotificationSettings) {
    guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else {
        finish(["status": settings.authorizationStatus == .notDetermined ? "permission_required" : "denied"])
        return
    }
    if arguments.contains("--status") {
        finish(["status": "authorized", "alertSetting": settings.alertSetting.rawValue,
                "soundSetting": settings.soundSetting.rawValue])
        return
    }
    guard let identifier = value("--id"), let title = value("--title"), let message = value("--message") else {
        finish(["status": "error", "reason": "Missing notification arguments"])
        return
    }
    let content = UNMutableNotificationContent()
    content.title = title
    content.body = message
    content.sound = .default
    let request = UNNotificationRequest(identifier: identifier, content: content, trigger: nil)
    center.add(request) { error in
        DispatchQueue.main.async {
            if let error = error {
                finish(["status": "error", "reason": error.localizedDescription])
                return
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                center.getDeliveredNotifications { notifications in
                    DispatchQueue.main.async {
                        finish(["status": "scheduled", "delivered": notifications.contains { $0.request.identifier == identifier },
                                "alertSetting": settings.alertSetting.rawValue])
                    }
                }
            }
        }
    }
}

center.getNotificationSettings { settings in
    if settings.authorizationStatus == .notDetermined && arguments.contains("--request-permission") {
        center.requestAuthorization(options: [.alert, .sound]) { _, error in
            if let error = error {
                DispatchQueue.main.async { finish(["status": "error", "reason": error.localizedDescription]) }
                return
            }
            center.getNotificationSettings { updated in
                DispatchQueue.main.async { perform(updated) }
            }
        }
    } else {
        DispatchQueue.main.async { perform(settings) }
    }
}

let deadline = Date().addingTimeInterval(45)
while !finished && Date() < deadline {
    RunLoop.main.run(until: Date().addingTimeInterval(0.1))
}
if !finished { finish(["status": "error", "reason": "Notification service or permission request timed out"]) }
