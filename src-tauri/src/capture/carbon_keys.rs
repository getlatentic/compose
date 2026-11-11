//! A shortcut in the terms macOS's `RegisterEventHotKey` takes — a virtual key
//! code and Carbon modifier bits — for the shortcuts helper, which registers the
//! same keys while Compose is not running. The codes are Apple's `kVK_*`
//! constants (HIToolbox `Events.h`), the ones the global-hotkey crate registers
//! Compose's own shortcuts with, so both mean the same physical keys.

use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut};

const CMD_KEY: u32 = 1 << 8;
const SHIFT_KEY: u32 = 1 << 9;
const OPTION_KEY: u32 = 1 << 11;
const CONTROL_KEY: u32 = 1 << 12;

/// `(key code, modifiers)`; `None` for a key `RegisterEventHotKey` cannot take,
/// such as a media key.
pub(super) fn carbon_key(shortcut: &Shortcut) -> Option<(u32, u32)> {
    Some((key_code(shortcut.key)?, modifiers(shortcut.mods)))
}

fn modifiers(mods: Modifiers) -> u32 {
    let mut bits = 0;
    if mods.contains(Modifiers::SHIFT) {
        bits |= SHIFT_KEY;
    }
    if mods.intersects(Modifiers::SUPER | Modifiers::META) {
        bits |= CMD_KEY;
    }
    if mods.contains(Modifiers::ALT) {
        bits |= OPTION_KEY;
    }
    if mods.contains(Modifiers::CONTROL) {
        bits |= CONTROL_KEY;
    }
    bits
}

fn key_code(code: Code) -> Option<u32> {
    letter(code).or_else(|| digit(code)).or_else(|| punctuation(code)).or_else(|| function_key(code)).or_else(|| other_key(code))
}

fn letter(code: Code) -> Option<u32> {
    Some(match code {
        Code::KeyA => 0x00,
        Code::KeyS => 0x01,
        Code::KeyD => 0x02,
        Code::KeyF => 0x03,
        Code::KeyH => 0x04,
        Code::KeyG => 0x05,
        Code::KeyZ => 0x06,
        Code::KeyX => 0x07,
        Code::KeyC => 0x08,
        Code::KeyV => 0x09,
        Code::KeyB => 0x0b,
        Code::KeyQ => 0x0c,
        Code::KeyW => 0x0d,
        Code::KeyE => 0x0e,
        Code::KeyR => 0x0f,
        Code::KeyY => 0x10,
        Code::KeyT => 0x11,
        Code::KeyO => 0x1f,
        Code::KeyU => 0x20,
        Code::KeyI => 0x22,
        Code::KeyP => 0x23,
        Code::KeyL => 0x25,
        Code::KeyJ => 0x26,
        Code::KeyK => 0x28,
        Code::KeyN => 0x2d,
        Code::KeyM => 0x2e,
        _ => return None,
    })
}

fn digit(code: Code) -> Option<u32> {
    Some(match code {
        Code::Digit1 => 0x12,
        Code::Digit2 => 0x13,
        Code::Digit3 => 0x14,
        Code::Digit4 => 0x15,
        Code::Digit6 => 0x16,
        Code::Digit5 => 0x17,
        Code::Digit9 => 0x19,
        Code::Digit7 => 0x1a,
        Code::Digit8 => 0x1c,
        Code::Digit0 => 0x1d,
        Code::Numpad0 => 0x52,
        Code::Numpad1 => 0x53,
        Code::Numpad2 => 0x54,
        Code::Numpad3 => 0x55,
        Code::Numpad4 => 0x56,
        Code::Numpad5 => 0x57,
        Code::Numpad6 => 0x58,
        Code::Numpad7 => 0x59,
        Code::Numpad8 => 0x5b,
        Code::Numpad9 => 0x5c,
        _ => return None,
    })
}

fn punctuation(code: Code) -> Option<u32> {
    Some(match code {
        Code::Equal => 0x18,
        Code::Minus => 0x1b,
        Code::BracketRight => 0x1e,
        Code::BracketLeft => 0x21,
        Code::Quote => 0x27,
        Code::Semicolon => 0x29,
        Code::Backslash => 0x2a,
        Code::Comma => 0x2b,
        Code::Slash => 0x2c,
        Code::Period => 0x2f,
        Code::Backquote => 0x32,
        Code::NumpadDecimal => 0x41,
        Code::NumpadMultiply => 0x43,
        Code::NumpadAdd => 0x45,
        Code::NumpadDivide => 0x4b,
        Code::NumpadSubtract => 0x4e,
        Code::NumpadEqual => 0x51,
        _ => return None,
    })
}

fn function_key(code: Code) -> Option<u32> {
    Some(match code {
        Code::F1 => 0x7a,
        Code::F2 => 0x78,
        Code::F3 => 0x63,
        Code::F4 => 0x76,
        Code::F5 => 0x60,
        Code::F6 => 0x61,
        Code::F7 => 0x62,
        Code::F8 => 0x64,
        Code::F9 => 0x65,
        Code::F10 => 0x6d,
        Code::F11 => 0x67,
        Code::F12 => 0x6f,
        Code::F13 => 0x69,
        Code::F14 => 0x6b,
        Code::F15 => 0x71,
        Code::F16 => 0x6a,
        Code::F17 => 0x40,
        Code::F18 => 0x4f,
        Code::F19 => 0x50,
        Code::F20 => 0x5a,
        _ => return None,
    })
}

fn other_key(code: Code) -> Option<u32> {
    Some(match code {
        Code::Enter => 0x24,
        Code::Tab => 0x30,
        Code::Space => 0x31,
        Code::Backspace => 0x33,
        Code::Escape => 0x35,
        Code::CapsLock => 0x39,
        Code::PrintScreen => 0x46,
        Code::NumLock => 0x47,
        Code::AudioVolumeUp => 0x48,
        Code::AudioVolumeDown => 0x49,
        Code::AudioVolumeMute => 0x4a,
        Code::NumpadEnter => 0x4c,
        Code::Insert => 0x72,
        Code::Home => 0x73,
        Code::PageUp => 0x74,
        Code::Delete => 0x75,
        Code::End => 0x77,
        Code::PageDown => 0x79,
        Code::ArrowLeft => 0x7b,
        Code::ArrowRight => 0x7c,
        Code::ArrowDown => 0x7d,
        Code::ArrowUp => 0x7e,
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn carbon(shortcut: &str) -> Option<(u32, u32)> {
        carbon_key(&shortcut.parse().expect("shortcut"))
    }

    #[test]
    fn the_default_shortcuts_are_the_keys_macos_calls_n_and_v_with_control_and_option() {
        assert_eq!(carbon("Control+Alt+KeyN"), Some((0x2d, CONTROL_KEY | OPTION_KEY)));
        assert_eq!(carbon("Control+Alt+KeyV"), Some((0x09, CONTROL_KEY | OPTION_KEY)));
    }

    #[test]
    fn command_and_shift_carry_their_own_bits() {
        assert_eq!(carbon("Super+Shift+Space"), Some((0x31, CMD_KEY | SHIFT_KEY)));
        assert_eq!(carbon("Control+Alt+Shift+F5"), Some((0x60, CONTROL_KEY | OPTION_KEY | SHIFT_KEY)));
    }

    #[test]
    fn a_media_key_has_no_carbon_code() {
        assert_eq!(carbon("MediaPlayPause"), None);
    }
}
