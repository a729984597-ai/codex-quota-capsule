use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapsuleViewModel {
    pub state: String,
    pub tone: String,
    pub status_label: String,
    pub judgment_text: String,
    pub used_percent: Option<f64>,
    pub reset_countdown_text: String,
    pub freshness_text: String,
    pub is_stale: bool,
    pub diagnostic_code: Option<String>,
    pub fetched_at_iso: Option<String>,
    pub resets_at_iso: Option<String>,
}

impl CapsuleViewModel {
    pub fn placeholder() -> Self {
        Self {
            state: "dataUnavailable".into(),
            tone: "unknown".into(),
            status_label: "数据暂不可用".into(),
            judgment_text: "等待首次刷新…".into(),
            used_percent: None,
            reset_countdown_text: "重置时间未知".into(),
            freshness_text: "尚未成功读取".into(),
            is_stale: false,
            diagnostic_code: None,
            fetched_at_iso: None,
            resets_at_iso: None,
        }
    }

    pub fn node_missing() -> Self {
        Self {
            state: "dataUnavailable".into(),
            tone: "unknown".into(),
            status_label: "数据暂不可用".into(),
            judgment_text: "未找到 Node.js，无法刷新额度数据".into(),
            used_percent: None,
            reset_countdown_text: "重置时间未知".into(),
            freshness_text: "尚未成功读取".into(),
            is_stale: false,
            diagnostic_code: Some("node_missing".into()),
            fetched_at_iso: None,
            resets_at_iso: None,
        }
    }

    pub fn tooltip(&self) -> String {
        let used = self
            .used_percent
            .map(|n| format!("{:.0}%", n))
            .unwrap_or_else(|| "—".into());
        format!(
            "{} · 本周已用 {} · {}",
            self.status_label, used, self.reset_countdown_text
        )
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
