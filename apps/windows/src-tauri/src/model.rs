use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageBreakdown {
    pub auto_percent: Option<f64>,
    pub api_percent: Option<f64>,
    pub total_percent: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSlice {
    pub provider: String,
    pub state: String,
    pub tone: String,
    pub status_label: String,
    pub judgment_text: String,
    pub used_percent: Option<f64>,
    #[serde(default)]
    pub usage_breakdown: Option<UsageBreakdown>,
    pub reset_countdown_text: String,
    pub freshness_text: String,
    pub is_stale: bool,
    pub diagnostic_code: Option<String>,
    pub fetched_at_iso: Option<String>,
    pub resets_at_iso: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapsuleViewModel {
    #[serde(default = "default_provider")]
    pub provider: String,
    #[serde(default = "default_display_mode")]
    pub display_mode: String,
    pub state: String,
    pub tone: String,
    pub status_label: String,
    pub judgment_text: String,
    pub used_percent: Option<f64>,
    #[serde(default)]
    pub usage_breakdown: Option<UsageBreakdown>,
    pub reset_countdown_text: String,
    pub freshness_text: String,
    pub is_stale: bool,
    pub diagnostic_code: Option<String>,
    pub fetched_at_iso: Option<String>,
    pub resets_at_iso: Option<String>,
    #[serde(default)]
    pub providers: Option<Vec<ProviderSlice>>,
}

fn default_provider() -> String {
    "codex".into()
}

fn default_display_mode() -> String {
    "single".into()
}

impl CapsuleViewModel {
    pub fn placeholder() -> Self {
        Self {
            provider: "codex".into(),
            display_mode: "single".into(),
            state: "dataUnavailable".into(),
            tone: "unknown".into(),
            status_label: "数据暂不可用".into(),
            judgment_text: "等待首次刷新…".into(),
            used_percent: None,
            usage_breakdown: None,
            reset_countdown_text: "重置时间未知".into(),
            freshness_text: "尚未成功读取".into(),
            is_stale: false,
            diagnostic_code: None,
            fetched_at_iso: None,
            resets_at_iso: None,
            providers: None,
        }
    }

    pub fn node_missing() -> Self {
        Self {
            provider: "codex".into(),
            display_mode: "single".into(),
            state: "dataUnavailable".into(),
            tone: "unknown".into(),
            status_label: "数据暂不可用".into(),
            judgment_text: "未找到 Node.js，无法刷新额度数据".into(),
            used_percent: None,
            usage_breakdown: None,
            reset_countdown_text: "重置时间未知".into(),
            freshness_text: "尚未成功读取".into(),
            is_stale: false,
            diagnostic_code: Some("node_missing".into()),
            fetched_at_iso: None,
            resets_at_iso: None,
            providers: None,
        }
    }

    pub fn tooltip(&self) -> String {
        if self.display_mode == "both" {
            if let Some(providers) = &self.providers {
                let parts: Vec<String> = providers
                    .iter()
                    .map(|p| {
                        format!(
                            "{} {}",
                            label_provider(&p.provider),
                            format_used(p.used_percent, p.usage_breakdown.as_ref())
                        )
                    })
                    .collect();
                return parts.join(" · ");
            }
        }
        format!(
            "{} · {} · {} · {}",
            label_provider(&self.provider),
            self.status_label,
            format_used(self.used_percent, self.usage_breakdown.as_ref()),
            self.reset_countdown_text
        )
    }
}

fn format_used(used: Option<f64>, breakdown: Option<&UsageBreakdown>) -> String {
    if let Some(b) = breakdown {
        let auto = b
            .auto_percent
            .map(|n| format!("{:.0}%", n))
            .unwrap_or_else(|| "—".into());
        let api = b
            .api_percent
            .map(|n| format!("{:.0}%", n))
            .unwrap_or_else(|| "—".into());
        return format!("Auto {} / API {}", auto, api);
    }
    used.map(|n| format!("{:.0}%", n))
        .unwrap_or_else(|| "—".into())
}

fn label_provider(provider: &str) -> &'static str {
    match provider {
        "cursor" => "Cursor",
        "both" => "双源",
        _ => "Codex",
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshPayload {
    pub ok: bool,
    pub view_model: CapsuleViewModel,
    pub snapshot_meta: Option<SnapshotMeta>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotMeta {
    pub source_status: Option<String>,
    pub diagnostic_code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LastSuccessFile {
    pub used_percent: Option<f64>,
    pub fetched_at_iso: Option<String>,
    pub resets_at_iso: Option<String>,
    pub view_model: CapsuleViewModel,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowPosition {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderPreference {
    /// auto | cursor | codex | both
    pub mode: String,
}

impl Default for ProviderPreference {
    fn default() -> Self {
        Self {
            mode: "auto".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FontPreference {
    /// small | standard | large | xlarge
    pub size: String,
}

impl Default for FontPreference {
    fn default() -> Self {
        Self {
            size: "standard".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LayoutPreference {
    /// standard | minimal
    pub mode: String,
}

impl Default for LayoutPreference {
    fn default() -> Self {
        Self {
            mode: "standard".into(),
        }
    }
}
