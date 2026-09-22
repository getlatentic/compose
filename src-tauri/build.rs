use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        link_swift();
    }
    tauri_build::build()
}

/// The app's few calls into Swift-only frameworks, `native/`, compiled into a
/// static library the app links. A toolchain that cannot build it leaves them
/// out: the widgets then refresh on WidgetKit's schedule instead.
fn link_swift() {
    println!("cargo:rustc-check-cfg=cfg(compose_native)");
    println!("cargo:rerun-if-changed=native");
    println!("cargo:rerun-if-env-changed=MACOSX_DEPLOYMENT_TARGET");
    match build_swift() {
        Ok(()) => println!("cargo:rustc-cfg=compose_native"),
        Err(error) => println!("cargo:warning=native Swift left out ({error}); widgets refresh on WidgetKit's schedule"),
    }
}

fn build_swift() -> Result<(), String> {
    let arch = match env::var("CARGO_CFG_TARGET_ARCH").as_deref() {
        Ok("aarch64") => "arm64",
        Ok("x86_64") => "x86_64",
        other => return Err(format!("no Swift target for {other:?}")),
    };
    let minimum = env::var("MACOSX_DEPLOYMENT_TARGET").unwrap_or_else(|_| "10.13".to_owned());
    let out = PathBuf::from(env::var("OUT_DIR").map_err(|error| error.to_string())?);
    let sdk = xcrun(&["--sdk", "macosx", "--show-sdk-path"])?;
    let swiftc = xcrun(&["--sdk", "macosx", "--find", "swiftc"])?;
    let sources: Vec<PathBuf> = std::fs::read_dir("native")
        .map_err(|error| error.to_string())?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.extension().is_some_and(|extension| extension == "swift"))
        .collect();
    let status = Command::new(&swiftc)
        .args(["-target", &format!("{arch}-apple-macos{minimum}"), "-sdk", &sdk])
        .args(["-module-name", "ComposeNative", "-parse-as-library", "-O", "-emit-library", "-static"])
        // Weak, so the app still launches on a macOS without WidgetKit.
        .args(["-Xfrontend", "-disable-autolink-framework", "-Xfrontend", "WidgetKit"])
        .arg("-o")
        .arg(out.join("libcompose_native.a"))
        .args(&sources)
        .status()
        .map_err(|error| format!("swiftc: {error}"))?;
    if !status.success() {
        return Err(format!("swiftc exited with {status}"));
    }
    let toolchain_swift = Path::new(&swiftc)
        .parent()
        .and_then(Path::parent)
        .map(|toolchain| toolchain.join("lib/swift/macosx"))
        .ok_or("no toolchain beside swiftc")?;
    println!("cargo:rustc-link-search=native={}", out.display());
    println!("cargo:rustc-link-lib=static=compose_native");
    println!("cargo:rustc-link-search=native={sdk}/usr/lib/swift");
    println!("cargo:rustc-link-search=native={}", toolchain_swift.display());
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    println!("cargo:rustc-link-arg=-Wl,-weak_framework,WidgetKit");
    Ok(())
}

fn xcrun(args: &[&str]) -> Result<String, String> {
    let output = Command::new("xcrun").args(args).output().map_err(|error| format!("xcrun: {error}"))?;
    if !output.status.success() {
        return Err(format!("xcrun {} failed", args.join(" ")));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}
