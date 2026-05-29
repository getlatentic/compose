use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PtySessionDescriptor {
    pub cwd: String,
    pub shell: String,
}
