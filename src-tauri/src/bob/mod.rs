use serde::{Deserialize, Serialize};

pub mod chat_event;
pub mod locator;
pub mod runner;

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BobRunMode {
    JsonTask,
    StreamJson,
    ResumeLatest,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BobChatMode {
    Plan,
    Code,
    Advanced,
    Ask,
}

impl BobChatMode {
    fn as_cli_value(self) -> &'static str {
        match self {
            Self::Plan => "plan",
            Self::Code => "code",
            Self::Advanced => "advanced",
            Self::Ask => "ask",
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BobApprovalMode {
    Default,
    AutoEdit,
}

impl BobApprovalMode {
    fn as_cli_value(self) -> &'static str {
        match self {
            Self::Default => "default",
            Self::AutoEdit => "auto_edit",
        }
    }
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BobCommandRequest {
    pub approval_mode: BobApprovalMode,
    pub chat_mode: BobChatMode,
    #[serde(default)]
    pub context_file_paths: Vec<String>,
    pub max_coins: u32,
    pub mode: BobRunMode,
    pub prompt: Option<String>,
    #[serde(default)]
    pub workspace_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BobCommandPreview {
    pub args: Vec<String>,
    pub cwd_required: bool,
    pub env: Vec<BobEnvironmentBinding>,
    pub program: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BobEnvironmentBinding {
    pub key: String,
    pub secret: bool,
}

pub fn build_bob_command(
    request: &BobCommandRequest,
) -> Result<BobCommandPreview, BobCommandError> {
    let prompt = normalized_prompt(request.prompt.as_deref());
    let mut args = api_key_args();

    match request.mode {
        BobRunMode::JsonTask => {
            let prompt = prompt.ok_or(BobCommandError::PromptRequired)?;
            args.push(prompt.to_owned());
            args.extend(task_args(
                request.chat_mode,
                "json",
                request.approval_mode,
                request.max_coins,
            ));
        }
        BobRunMode::StreamJson => {
            let prompt = prompt.ok_or(BobCommandError::PromptRequired)?;
            args.push(prompt.to_owned());
            args.extend(task_args(
                request.chat_mode,
                "stream-json",
                request.approval_mode,
                request.max_coins,
            ));
        }
        BobRunMode::ResumeLatest => {
            args.push("--resume".to_owned());
            args.push("latest".to_owned());
            args.push("--output-format".to_owned());
            args.push("stream-json".to_owned());
        }
    }

    Ok(BobCommandPreview {
        args,
        cwd_required: true,
        env: bob_environment_bindings(),
        program: "bob".to_owned(),
    })
}

fn api_key_args() -> Vec<String> {
    vec!["--auth-method".to_owned(), "api-key".to_owned()]
}

fn bob_environment_bindings() -> Vec<BobEnvironmentBinding> {
    vec![BobEnvironmentBinding {
        key: "BOBSHELL_API_KEY".to_owned(),
        secret: true,
    }]
}

fn task_args(
    chat_mode: BobChatMode,
    output_format: &str,
    approval_mode: BobApprovalMode,
    max_coins: u32,
) -> Vec<String> {
    vec![
        "--chat-mode".to_owned(),
        chat_mode.as_cli_value().to_owned(),
        "--output-format".to_owned(),
        output_format.to_owned(),
        "--approval-mode".to_owned(),
        approval_mode.as_cli_value().to_owned(),
        "--max-coins".to_owned(),
        max_coins.to_string(),
    ]
}

fn normalized_prompt(prompt: Option<&str>) -> Option<&str> {
    prompt.map(str::trim).filter(|value| !value.is_empty())
}

#[derive(Debug, PartialEq, Eq)]
pub enum BobCommandError {
    PromptRequired,
}

impl std::fmt::Display for BobCommandError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::PromptRequired => formatter.write_str("prompt is required for this Bob run mode"),
        }
    }
}

impl std::error::Error for BobCommandError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_stream_json_command_with_safe_defaults() {
        let request = BobCommandRequest {
            approval_mode: BobApprovalMode::Default,
            chat_mode: BobChatMode::Plan,
            context_file_paths: Vec::new(),
            max_coins: 200,
            mode: BobRunMode::StreamJson,
            prompt: Some("Review this workspace".to_owned()),
            workspace_id: Some("workspace-1".to_owned()),
        };

        let preview = build_bob_command(&request).expect("valid command");

        assert_eq!(preview.program, "bob");
        assert_eq!(
            preview.args,
            vec![
                "--auth-method",
                "api-key",
                "Review this workspace",
                "--chat-mode",
                "plan",
                "--output-format",
                "stream-json",
                "--approval-mode",
                "default",
                "--max-coins",
                "200",
            ]
        );
        assert_eq!(
            preview.env,
            vec![BobEnvironmentBinding {
                key: "BOBSHELL_API_KEY".to_owned(),
                secret: true
            }]
        );
        assert!(preview.cwd_required);
    }

    #[test]
    fn rejects_blank_prompt_for_task_modes() {
        let request = BobCommandRequest {
            approval_mode: BobApprovalMode::AutoEdit,
            chat_mode: BobChatMode::Code,
            context_file_paths: Vec::new(),
            max_coins: 200,
            mode: BobRunMode::JsonTask,
            prompt: Some("   ".to_owned()),
            workspace_id: None,
        };

        assert_eq!(
            build_bob_command(&request).expect_err("blank prompt must fail"),
            BobCommandError::PromptRequired
        );
    }

    #[test]
    fn builds_resume_command_with_api_key_auth() {
        let request = BobCommandRequest {
            approval_mode: BobApprovalMode::Default,
            chat_mode: BobChatMode::Plan,
            context_file_paths: Vec::new(),
            max_coins: 200,
            mode: BobRunMode::ResumeLatest,
            prompt: None,
            workspace_id: Some("workspace-1".to_owned()),
        };

        let preview = build_bob_command(&request).expect("valid command");

        assert_eq!(
            preview.args,
            vec![
                "--auth-method",
                "api-key",
                "--resume",
                "latest",
                "--output-format",
                "stream-json"
            ]
        );
        assert!(preview
            .env
            .iter()
            .any(|binding| binding.key == "BOBSHELL_API_KEY" && binding.secret));
    }
}
