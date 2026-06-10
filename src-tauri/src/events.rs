use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BobEventEnvelope {
    pub run_id: String,
    pub sequence: u64,
    pub stream: BobEventStream,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BobEventStream {
    Stdout,
    Stderr,
    Tool,
    File,
    Complete,
}
