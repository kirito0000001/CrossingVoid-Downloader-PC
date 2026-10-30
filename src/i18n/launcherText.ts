export type LauncherLanguage = "zh-Hans" | "zh-Hant" | "en" | "ja";

export type TranslationKey =
  | "brand.title"
  | "nav.quickLinks"
  | "news.characters"
  | "news.notice"
  | "news.video"
  | "window.settings"
  | "window.minimize"
  | "window.close"
  | "action.checking"
  | "action.pauseDownload"
  | "action.cancelInstall"
  | "action.cancelVerification"
  | "action.cancelRepair"
  | "action.cancelling"
  | "action.pauseUpload"
  | "action.resumeUpload"
  | "action.launchingGame"
  | "action.gameRunning"
  | "action.launchGame"
  | "action.updateGame"
  | "action.installGame"
  | "action.installing"
  | "action.resumeDownload"
  | "action.downloadGame"
  | "action.repairFiles"
  | "action.updateLauncher"
  | "action.updateLauncherReady"
  | "status.checking"
  | "status.checkingFile"
  | "status.verificationIssues"
  | "status.filesMissing"
  | "status.repairingFiles"
  | "status.repairPreparing"
  | "status.repairDownloading"
  | "status.repairWriting"
  | "status.repairVerifying"
  | "status.versionChecking"
  | "status.launchingGame"
  | "status.gameRunning"
  | "status.updateAvailable"
  | "status.launcherUpdateChecking"
  | "status.launcherUpdateAvailable"
  | "status.launcherUpdateDownloading"
  | "status.launcherUpdateInstalling"
  | "status.launcherUpdateRestarting"
  | "status.downloading"
  | "download.estimateCalculating"
  | "download.estimateStalled"
  | "download.estimatedRemaining"
  | "download.hour"
  | "download.minute"
  | "download.lessThanMinute"
  | "status.downloaded"
  | "status.installing"
  | "installStage.merging"
  | "installStage.verifying"
  | "installStage.extracting"
  | "installStage.finishing"
  | "installStage.patchDownloading"
  | "installStage.patchApplying"
  | "status.ready"
  | "status.paused"
  | "status.waiting"
  | "settings.preferences"
  | "settings.download"
  | "settings.game"
  | "settings.about"
  | "settings.developer"
  | "settings.launcherLanguage"
  | "settings.launcherLanguageHint"
  | "settings.runtime"
  | "settings.closeWindow"
  | "settings.exitLauncher"
  | "settings.minimizeToTray"
  | "settings.display"
  | "settings.hideAfterGameLaunch"
  | "settings.downloadSource"
  | "settings.autoSourceFallback"
  | "settings.autoSourceFallbackHint"
  | "settings.githubUseSystemProxy"
  | "settings.githubUseSystemProxyHint"
  | "settings.downloadSpeed"
  | "settings.cancelDownload"
  | "settings.cancelDownloadHint"
  | "settings.unlimited"
  | "settings.limited"
  | "settings.installPath"
  | "settings.openGameFolder"
  | "settings.relocateGame"
  | "settings.migrateGame"
  | "settings.gameLog"
  | "settings.openGameLog"
  | "settings.gameManagement"
  | "settings.deleteGame"
  | "settings.uninstallLauncher"
  | "settings.otherLaunchOptions"
  | "settings.autoRepair"
  | "settings.autoRepairHint"
  | "settings.gameVersion"
  | "settings.aboutLauncher"
  | "settings.launcherVersion"
  | "settings.checkVersion"
  | "settings.checkingLauncherUpdate"
  | "settings.launcherUpdateReady"
  | "settings.launcherLog"
  | "settings.openLogFolder"
  | "settings.termsPolicy"
  | "settings.userAgreement"
  | "settings.privacyPolicy"
  | "dev.setVersion"
  | "dev.versionHint"
  | "dev.packageLauncher"
  | "dev.publishLauncher"
  | "dev.openProjectFolder"
  | "dev.packageTitle"
  | "dev.packagePath"
  | "dev.choosePath"
  | "dev.cancel"
  | "dev.startPackage"
  | "dev.running"
  | "downloadSource.official"
  | "downloadSource.officialDesc"
  | "downloadSource.github"
  | "downloadSource.githubDesc"
  | "traffic.title"
  | "traffic.remaining"
  | "traffic.expires"
  | "traffic.lowHint"
  | "traffic.updating"
  | "traffic.unavailable"
  | "traffic.low"
  | "traffic.throttled"
  | "traffic.sourcePaused"
  | "profile.featureCode"
  | "profile.weeklyActive"
  | "profile.resourceReserve"
  | "profile.level"
  | "profile.note"
  | "tool.more"
  | "tool.openLocalFiles"
  | "tool.verifyIntegrity"
  | "tool.checkUpdates"
  | "tool.offlineMode"
  | "tool.useDx11"
  | "quick.teamSite"
  | "quick.teamSiteTip"
  | "quick.gameSite"
  | "quick.gameSiteTip"
  | "quick.wiki"
  | "quick.wikiTip"
  | "quick.wechat"
  | "quick.wechatTip"
  | "quick.wechatQrAlt"
  | "quick.bilibili"
  | "quick.bilibiliTip"
  | "quick.bilibiliQrAlt"
  | "quick.qq"
  | "quick.qqTip"
  | "quick.qqQrAlt"
  | "quick.bugReport"
  | "quick.bugReportTip"
  | "feedback.title"
  | "feedback.loading"
  | "feedback.empty"
  | "feedback.refresh"
  | "feedback.close"
  | "feedback.back"
  | "feedback.filter.label"
  | "feedback.filter.all"
  | "feedback.filter.empty"
  | "feedback.submit.open"
  | "feedback.submit.category"
  | "feedback.submit.nickname"
  | "feedback.submit.nicknamePlaceholder"
  | "feedback.submit.nicknameHint"
  | "feedback.submit.title"
  | "feedback.submit.titlePlaceholder"
  | "feedback.submit.titleCount"
  | "feedback.submit.description"
  | "feedback.submit.descriptionPlaceholder"
  | "feedback.submit.descriptionCount"
  | "feedback.submit.includeEnvironment"
  | "feedback.submit.env.launcher"
  | "feedback.submit.env.game"
  | "feedback.submit.env.path"
  | "feedback.submit.send"
  | "feedback.submit.sending"
  | "feedback.submit.created"
  | "feedback.submit.note"
  | "feedback.count.bug"
  | "feedback.count.suggestion"
  | "feedback.comments"
  | "feedback.comments.title"
  | "feedback.comments.empty"
  | "feedback.compose.placeholder"
  | "feedback.compose.send"
  | "feedback.compose.sending"
  | "feedback.openOnGithub"
  | "feedback.age.justNow"
  | "feedback.age.minutes"
  | "feedback.age.hours"
  | "feedback.age.days"
  | "feedback.category.bug"
  | "feedback.category.suggestion"
  | "feedback.category.improvement"
  | "feedback.category.question"
  | "feedback.category.other"
  | "side.expand"
  | "side.collapse"
  | "install.title"
  | "install.migrationTitle"
  | "install.close"
  | "install.change"
  | "install.requiredSpace"
  | "install.availableSpace"
  | "install.desktopShortcut"
  | "install.continue"
  | "install.confirmMigration"
  | "space.querying"
  | "space.checking"
  | "space.unavailable"
  | "confirm.deleteTitle"
  | "confirm.deleteBody"
  | "confirm.delete"
  | "confirm.cancelDownloadTitle"
  | "confirm.cancelDownloadBody"
  | "confirm.cancelDownload"
  | "confirm.uninstallLauncherTitle"
  | "confirm.uninstallLauncherBody"
  | "confirm.uninstallLauncher"
  | "confirm.cancel"
  | "dialog.chooseInstallPath"
  | "dialog.chooseGamePath"
  | "dialog.chooseMigrationPath";

export const languageLabels: Record<LauncherLanguage, string> = {
  "zh-Hans": "简体中文",
  "zh-Hant": "繁體中文",
  en: "English",
  ja: "日本語",
};
export const languageOptions = Object.values(languageLabels);
export const languageByLabel = Object.fromEntries(
  Object.entries(languageLabels).map(([key, label]) => [label, key]),
) as Record<string, LauncherLanguage>;

export const translations: Record<LauncherLanguage, Record<TranslationKey, string>> = {
  "zh-Hans": {
    "brand.title": "零境交错:空界幻境",
    "nav.quickLinks": "快捷入口",
    "news.characters": "角色",
    "news.notice": "公告",
    "news.video": "视频",
    "window.settings": "设置",
    "window.minimize": "最小化",
    "window.close": "关闭",
    "action.checking": "检查中",
    "action.pauseDownload": "暂停下载",
    "action.cancelInstall": "取消安装",
    "action.cancelVerification": "取消校验",
    "action.cancelRepair": "取消修复",
    "action.cancelling": "正在取消",
    "action.pauseUpload": "暂停上传",
    "action.resumeUpload": "继续上传",
    "action.launchingGame": "启动中",
    "action.gameRunning": "游戏运行中",
    "action.launchGame": "启动游戏",
    "action.updateGame": "下载更新",
    "action.installGame": "安装游戏",
    "action.installing": "安装中",
    "action.resumeDownload": "继续下载",
    "action.downloadGame": "下载游戏",
    "action.repairFiles": "修复文件",
    "action.updateLauncher": "更新启动器中",
    "action.updateLauncherReady": "更新启动器",
    "status.checking": "正在校验资源清单",
    "status.checkingFile": "正在校验 {file}",
    "status.verificationIssues": "发现异常 {count} 项",
    "status.filesMissing": "游戏文件缺失",
    "status.repairingFiles": "正在补齐文件",
    "status.repairPreparing": "正在准备修复信息",
    "status.repairDownloading": "正在下载修复文件",
    "status.repairWriting": "正在写入修复文件",
    "status.repairVerifying": "正在校验修复结果",
    "status.versionChecking": "检测版本中",
    "status.launchingGame": "正在启动游戏",
    "status.gameRunning": "游戏运行中",
    "status.updateAvailable": "发现新版本",
    "status.launcherUpdateChecking": "检查启动器更新中",
    "status.launcherUpdateAvailable": "发现启动器新版本",
    "status.launcherUpdateDownloading": "更新启动器中",
    "status.launcherUpdateInstalling": "安装启动器更新",
    "status.launcherUpdateRestarting": "更新完成，正在重启启动器",
    "status.downloading": "下载中",
    "download.estimateCalculating": "正在计算剩余时间",
    "download.estimateStalled": "下载暂时无进度",
    "download.estimatedRemaining": "预计剩余",
    "download.hour": "小时",
    "download.minute": "分钟",
    "download.lessThanMinute": "不足1分钟",
    "status.downloaded": "下载完成",
    "status.installing": "正在安装",
    "installStage.merging": "合并安装包",
    "installStage.verifying": "校验安装包",
    "installStage.extracting": "解压资源",
    "installStage.finishing": "完成安装",
    "installStage.patchDownloading": "下载补丁",
    "installStage.patchApplying": "应用补丁",
    "status.ready": "资源完整",
    "status.paused": "已暂停",
    "status.waiting": "等待下载",
    "settings.preferences": "偏好设置",
    "settings.download": "下载",
    "settings.game": "游戏",
    "settings.about": "关于",
    "settings.developer": "开发",
    "settings.launcherLanguage": "启动器语言",
    "settings.launcherLanguageHint": "选择启动器界面使用的显示语言。",
    "settings.runtime": "运行设置",
    "settings.closeWindow": "关闭启动器窗口",
    "settings.exitLauncher": "退出启动器",
    "settings.minimizeToTray": "最小化到系统托盘",
    "settings.display": "显示设置",
    "settings.hideAfterGameLaunch": "退出游戏后不弹出启动器",
    "settings.downloadSource": "下载源",
    "settings.autoSourceFallback": "自动换源",
    "settings.autoSourceFallbackHint": "首选源下载失败时自动改用另一个源，下载更稳定。关掉后只从你选择的源下载。",
    "settings.githubUseSystemProxy": "GitHub 走系统代理",
    "settings.githubUseSystemProxyHint": "开着时通过系统代理访问 GitHub。如果你的网络能直连 GitHub，关掉通常更快。",
    "settings.downloadSpeed": "下载速度",
    "settings.cancelDownload": "取消下载",
    "settings.cancelDownloadHint": "停止当前下载，并清除已经下载的游戏碎片和缓存。",
    "settings.unlimited": "不限制",
    "settings.limited": "限制",
    "settings.installPath": "游戏安装目录",
    "settings.openGameFolder": "打开游戏目录",
    "settings.relocateGame": "重新定位游戏",
    "settings.migrateGame": "迁移游戏文件",
    "settings.gameLog": "游戏日志",
    "settings.openGameLog": "打开游戏日志",
    "settings.gameManagement": "游戏管理",
    "settings.deleteGame": "删除游戏",
    "settings.uninstallLauncher": "卸载启动器",
    "settings.otherLaunchOptions": "其他启动选项",
    "settings.autoRepair": "自动修复资源",
    "settings.autoRepairHint": "启动前检查缺失文件并尝试补齐",
    "settings.gameVersion": "游戏版本",
    "settings.aboutLauncher": "关于启动器",
    "settings.launcherVersion": "启动器版本",
    "settings.checkVersion": "检查版本",
    "settings.checkingLauncherUpdate": "检查启动器更新中",
    "settings.launcherUpdateReady": "发现启动器新版本",
    "settings.launcherLog": "启动器日志",
    "settings.openLogFolder": "打开日志目录",
    "settings.termsPolicy": "条款与政策",
    "settings.userAgreement": "用户协议",
    "settings.privacyPolicy": "隐私政策",
    "dev.setVersion": "设置版本号",
    "dev.versionHint": "新版本号必须高于当前版本。当前版本：{version}",
    "dev.packageLauncher": "打包启动器",
    "dev.publishLauncher": "发布新版本包",
    "dev.openProjectFolder": "打开项目文件夹",
    "dev.packageTitle": "选择启动器打包路径",
    "dev.packagePath": "打包输出目录",
    "dev.choosePath": "更改",
    "dev.cancel": "取消",
    "dev.startPackage": "开始打包",
    "dev.running": "执行中",
    "downloadSource.official": "零境交错源",
    "downloadSource.officialDesc": "官方服务器下载源，速度最快。",
    "downloadSource.github": "Github源",
    "downloadSource.githubDesc": "需要魔法。",
    "traffic.title": "服务器可用下载流量",
    "traffic.remaining": "剩余流量",
    "traffic.expires": "最近到期",
    "traffic.lowHint": "服务器当前流量不足，请更换下载源。",
    "traffic.updating": "正在获取服务器流量额度…",
    "traffic.unavailable": "暂时无法获取流量额度，不影响下载。",
    "traffic.low": "服务器当前流量不足，请更换下载源。",
    "traffic.throttled": "下载源流量已用尽，服务商限速中，下载会明显变慢",
    "traffic.sourcePaused": "服务器当前流量不足，零境交错源下载已暂停。",
    "profile.featureCode": "特征码",
    "profile.weeklyActive": "每周活跃",
    "profile.resourceReserve": "资源储备",
    "profile.level": "等级",
    "profile.note": "查询结果可能存在延迟，正式接口接入前展示占位数据",
    "tool.more": "更多",
    "tool.openLocalFiles": "浏览本地文件",
    "tool.verifyIntegrity": "验证游戏完整性",
    "tool.checkUpdates": "重新检测更新",
    "tool.offlineMode": "单机模式游玩",
    "tool.useDx11": "使用DX11启动",
    "quick.teamSite": "团队官网",
    "quick.teamSiteTip": "访问团队官网",
    "quick.gameSite": "游戏官网",
    "quick.gameSiteTip": "访问游戏官网",
    "quick.wiki": "Wiki",
    "quick.wikiTip": "查看 Wiki 与资料站",
    "quick.wechat": "微信",
    "quick.wechatTip": "扫描关注微信公众号",
    "quick.wechatQrAlt": "微信公众号二维码",
    "quick.bilibili": "B站",
    "quick.bilibiliTip": "访问B站首页",
    "quick.bilibiliQrAlt": "B站主页二维码",
    "quick.qq": "QQ",
    "quick.qqTip": "零境交错同好会",
    "quick.qqQrAlt": "零境交错同好会二维码",
    "quick.bugReport": "BUG 提交",
    "quick.bugReportTip": "遇到问题或有建议，来这里反馈",
    "feedback.title": "玩家反馈",
    "feedback.loading": "正在读取反馈…",
    "feedback.empty": "目前没有未处理的问题",
    "feedback.refresh": "刷新",
    "feedback.close": "关闭",
    "feedback.back": "返回列表",
    "feedback.filter.label": "按分类筛选",
    "feedback.filter.all": "全部",
    "feedback.filter.empty": "这个分类下暂时没有内容",
    "feedback.submit.open": "我要反馈",
    "feedback.submit.category": "这是哪一类？",
    "feedback.submit.nickname": "你的昵称",
    "feedback.submit.nicknamePlaceholder": "想让别人怎么称呼你",
    "feedback.submit.nicknameHint": "只写进这条反馈里，会被记住，下次不用再填。",
    "feedback.submit.title": "一句话标题",
    "feedback.submit.titlePlaceholder": "什么情况下出的问题，例如：进入战斗后闪退",
    "feedback.submit.titleCount": "{count} / 60 字",
    "feedback.submit.description": "详细描述",
    "feedback.submit.descriptionPlaceholder": "你做了什么 → 你期望什么 → 实际发生了什么",
    "feedback.submit.descriptionCount": "{count} 字",
    "feedback.submit.includeEnvironment": "附带运行环境（版本、状态、安装目录已脱敏）",
    "feedback.submit.env.launcher": "启动器版本",
    "feedback.submit.env.game": "游戏版本",
    "feedback.submit.env.path": "安装目录",
    "feedback.submit.send": "提交反馈",
    "feedback.submit.sending": "正在提交…",
    "feedback.submit.created": "已提交为 #{number}，可以在列表里看到它。",
    "feedback.submit.note": "提交后会公开在 GitHub 上；请不要在内容里写账号或密码。",
    "feedback.count.bug": "当前BUG数目：{count}。",
    "feedback.count.suggestion": "当前建议数目：{count}。",
    "feedback.comments": "{count} 条评论",
    "feedback.comments.title": "评论",
    "feedback.comments.empty": "还没有评论",
    "feedback.compose.placeholder": "写下你的补充或复现步骤…",
    "feedback.compose.send": "发表评论",
    "feedback.compose.sending": "正在发表…",
    "feedback.openOnGithub": "在 GitHub 打开",
    "feedback.age.justNow": "刚刚",
    "feedback.age.minutes": "{count} 分钟前",
    "feedback.age.hours": "{count} 小时前",
    "feedback.age.days": "{count} 天前",
    "feedback.category.bug": "BUG",
    "feedback.category.suggestion": "建议",
    "feedback.category.improvement": "优化",
    "feedback.category.question": "提问",
    "feedback.category.other": "未分类",
    "side.expand": "展开左侧栏",
    "side.collapse": "收起左侧栏",
    "install.title": "选择安装路径",
    "install.migrationTitle": "选择迁移路径",
    "install.close": "关闭",
    "install.change": "更改",
    "install.requiredSpace": "所需空间",
    "install.availableSpace": "可用空间",
    "install.desktopShortcut": "桌面快捷方式",
    "install.continue": "继续安装",
    "install.confirmMigration": "确认迁移",
    "space.querying": "正在查询",
    "space.checking": "检测中",
    "space.unavailable": "无法检测",
    "confirm.deleteTitle": "删除游戏",
    "confirm.deleteBody": "将删除当前游戏目录，并把启动器状态恢复到未下载。此操作不会卸载启动器。",
    "confirm.delete": "删除",
    "confirm.cancelDownloadTitle": "取消游戏下载",
    "confirm.cancelDownloadBody": "将停止当前下载，并删除已经下载的游戏碎片和缓存。此操作不会删除已经安装的游戏。",
    "confirm.cancelDownload": "取消下载",
    "confirm.uninstallLauncherTitle": "卸载启动器",
    "confirm.uninstallLauncherBody": "将先删除当前游戏目录，再打开系统卸载程序卸载启动器本体。请确认已经不需要保留本机文件。",
    "confirm.uninstallLauncher": "卸载",
    "confirm.cancel": "取消",
    "dialog.chooseInstallPath": "选择游戏下载位置",
    "dialog.chooseGamePath": "选择已有游戏目录",
    "dialog.chooseMigrationPath": "选择新的游戏安装位置",
  },
  "zh-Hant": {
    "brand.title": "零境交錯:空界幻境",
    "nav.quickLinks": "快捷入口",
    "news.characters": "角色",
    "news.notice": "公告",
    "news.video": "影片",
    "window.settings": "設定",
    "window.minimize": "最小化",
    "window.close": "關閉",
    "action.checking": "檢查中",
    "action.pauseDownload": "暫停下載",
    "action.cancelInstall": "取消安裝",
    "action.cancelVerification": "取消校驗",
    "action.cancelRepair": "取消修復",
    "action.cancelling": "正在取消",
    "action.pauseUpload": "暫停上傳",
    "action.resumeUpload": "繼續上傳",
    "action.launchingGame": "啟動中",
    "action.gameRunning": "遊戲執行中",
    "action.launchGame": "啟動遊戲",
    "action.updateGame": "下載更新",
    "action.installGame": "安裝遊戲",
    "action.installing": "安裝中",
    "action.resumeDownload": "繼續下載",
    "action.downloadGame": "下載遊戲",
    "action.repairFiles": "修復檔案",
    "action.updateLauncher": "更新啟動器中",
    "action.updateLauncherReady": "更新啟動器",
    "status.checking": "正在校驗資源清單",
    "status.checkingFile": "正在校驗 {file}",
    "status.verificationIssues": "發現異常 {count} 項",
    "status.filesMissing": "遊戲檔案缺失",
    "status.repairingFiles": "正在補齊檔案",
    "status.repairPreparing": "正在準備修復資訊",
    "status.repairDownloading": "正在下載修復檔案",
    "status.repairWriting": "正在寫入修復檔案",
    "status.repairVerifying": "正在校驗修復結果",
    "status.versionChecking": "檢測版本中",
    "status.launchingGame": "正在啟動遊戲",
    "status.gameRunning": "遊戲執行中",
    "status.updateAvailable": "發現新版本",
    "status.launcherUpdateChecking": "檢查啟動器更新中",
    "status.launcherUpdateAvailable": "發現啟動器新版本",
    "status.launcherUpdateDownloading": "更新啟動器中",
    "status.launcherUpdateInstalling": "安裝啟動器更新",
    "status.launcherUpdateRestarting": "更新完成，正在重啟啟動器",
    "status.downloading": "下載中",
    "download.estimateCalculating": "正在計算剩餘時間",
    "download.estimateStalled": "下載暫時無進度",
    "download.estimatedRemaining": "預計剩餘",
    "download.hour": "小時",
    "download.minute": "分鐘",
    "download.lessThanMinute": "不足1分鐘",
    "status.downloaded": "下載完成",
    "status.installing": "正在安裝",
    "installStage.merging": "合併安裝包",
    "installStage.verifying": "校驗安裝包",
    "installStage.extracting": "解壓資源",
    "installStage.finishing": "完成安裝",
    "installStage.patchDownloading": "下載補丁",
    "installStage.patchApplying": "套用補丁",
    "status.ready": "資源完整",
    "status.paused": "已暫停",
    "status.waiting": "等待下載",
    "settings.preferences": "偏好設定",
    "settings.download": "下載",
    "settings.game": "遊戲",
    "settings.about": "關於",
    "settings.developer": "開發",
    "settings.launcherLanguage": "啟動器語言",
    "settings.launcherLanguageHint": "選擇啟動器介面使用的顯示語言。",
    "settings.runtime": "執行設定",
    "settings.closeWindow": "關閉啟動器視窗",
    "settings.exitLauncher": "退出啟動器",
    "settings.minimizeToTray": "最小化到系統匣",
    "settings.display": "顯示設定",
    "settings.hideAfterGameLaunch": "退出遊戲後不彈出啟動器",
    "settings.downloadSource": "下載源",
    "settings.autoSourceFallback": "自動換源",
    "settings.autoSourceFallbackHint": "首選來源下載失敗時自動改用另一個來源，下載更穩定。關掉後只從你選擇的來源下載。",
    "settings.githubUseSystemProxy": "GitHub 走系統代理",
    "settings.githubUseSystemProxyHint": "開著時透過系統代理存取 GitHub。如果你的網路能直連 GitHub，關掉通常更快。",
    "settings.downloadSpeed": "下載速度",
    "settings.cancelDownload": "取消下載",
    "settings.cancelDownloadHint": "停止目前下載，並清除已下載的遊戲碎片與快取。",
    "settings.unlimited": "不限制",
    "settings.limited": "限制",
    "settings.installPath": "遊戲安裝目錄",
    "settings.openGameFolder": "開啟遊戲目錄",
    "settings.relocateGame": "重新定位遊戲",
    "settings.migrateGame": "遷移遊戲檔案",
    "settings.gameLog": "遊戲日誌",
    "settings.openGameLog": "開啟遊戲日誌",
    "settings.gameManagement": "遊戲管理",
    "settings.deleteGame": "刪除遊戲",
    "settings.uninstallLauncher": "卸載啟動器",
    "settings.otherLaunchOptions": "其他啟動選項",
    "settings.autoRepair": "自動修復資源",
    "settings.autoRepairHint": "啟動前檢查缺失檔案並嘗試補齊",
    "settings.gameVersion": "遊戲版本",
    "settings.aboutLauncher": "關於啟動器",
    "settings.launcherVersion": "啟動器版本",
    "settings.checkVersion": "檢查版本",
    "settings.checkingLauncherUpdate": "檢查啟動器更新中",
    "settings.launcherUpdateReady": "發現啟動器新版本",
    "settings.launcherLog": "啟動器日誌",
    "settings.openLogFolder": "開啟日誌目錄",
    "settings.termsPolicy": "條款與政策",
    "settings.userAgreement": "使用者協議",
    "settings.privacyPolicy": "隱私政策",
    "dev.setVersion": "設定版本號",
    "dev.versionHint": "新版本號必須高於目前版本。目前版本：{version}",
    "dev.packageLauncher": "打包啟動器",
    "dev.publishLauncher": "發布新版本包",
    "dev.openProjectFolder": "開啟專案資料夾",
    "dev.packageTitle": "選擇啟動器打包路徑",
    "dev.packagePath": "打包輸出目錄",
    "dev.choosePath": "更改",
    "dev.cancel": "取消",
    "dev.startPackage": "開始打包",
    "dev.running": "執行中",
    "downloadSource.official": "零境交錯源",
    "downloadSource.officialDesc": "官方伺服器下載源，速度最快。",
    "downloadSource.github": "Github源",
    "downloadSource.githubDesc": "需要魔法。",
    "traffic.title": "伺服器可用下載流量",
    "traffic.remaining": "剩餘流量",
    "traffic.expires": "最近到期",
    "traffic.lowHint": "伺服器流量不足，可以切換 Github 源進行下載。",
    "traffic.updating": "正在取得伺服器流量額度…",
    "traffic.unavailable": "暫時無法取得流量額度，不影響下載。",
    "traffic.low": "伺服器目前流量不足",
    "traffic.throttled": "下載源流量已用盡，服務商限速中，下載會明顯變慢",
    "traffic.sourcePaused": "伺服器目前流量不足，零境交錯源下載已暫停。",
    "profile.featureCode": "特徵碼",
    "profile.weeklyActive": "每週活躍",
    "profile.resourceReserve": "資源儲備",
    "profile.level": "等級",
    "profile.note": "查詢結果可能存在延遲，正式介面接入前展示佔位資料",
    "tool.more": "更多",
    "tool.openLocalFiles": "瀏覽本機檔案",
    "tool.verifyIntegrity": "驗證遊戲完整性",
    "tool.checkUpdates": "重新檢測更新",
    "tool.offlineMode": "單機模式遊玩",
    "tool.useDx11": "使用DX11啟動",
    "quick.teamSite": "團隊官網",
    "quick.teamSiteTip": "造訪團隊官網",
    "quick.gameSite": "遊戲官網",
    "quick.gameSiteTip": "造訪遊戲官網",
    "quick.wiki": "Wiki",
    "quick.wikiTip": "查看 Wiki 與資料站",
    "quick.wechat": "微信",
    "quick.wechatTip": "掃描關注微信公眾號",
    "quick.wechatQrAlt": "微信公眾號 QR Code",
    "quick.bilibili": "B站",
    "quick.bilibiliTip": "造訪 B 站首頁",
    "quick.bilibiliQrAlt": "B站首頁 QR Code",
    "quick.qq": "QQ",
    "quick.qqTip": "零境交錯同好會",
    "quick.qqQrAlt": "零境交錯同好會 QR Code",
    "quick.bugReport": "BUG 提交",
    "quick.bugReportTip": "遇到問題或有建議，來這裡回報",
    "feedback.title": "玩家回報",
    "feedback.loading": "正在讀取回報…",
    "feedback.empty": "目前沒有未處理的問題",
    "feedback.refresh": "重新整理",
    "feedback.close": "關閉",
    "feedback.back": "返回列表",
    "feedback.filter.label": "按分類篩選",
    "feedback.filter.all": "全部",
    "feedback.filter.empty": "這個分類下暫時沒有內容",
    "feedback.submit.open": "我要回報",
    "feedback.submit.category": "這是哪一類？",
    "feedback.submit.nickname": "你的暱稱",
    "feedback.submit.nicknamePlaceholder": "想讓別人怎麼稱呼你",
    "feedback.submit.nicknameHint": "只寫進這條回報裡，會被記住，下次不用再填。",
    "feedback.submit.title": "一句話標題",
    "feedback.submit.titlePlaceholder": "什麼情況下出的問題，例如：進入戰鬥後閃退",
    "feedback.submit.titleCount": "{count} / 60 字",
    "feedback.submit.description": "詳細描述",
    "feedback.submit.descriptionPlaceholder": "你做了什麼 → 你期望什麼 → 實際發生了什麼",
    "feedback.submit.descriptionCount": "{count} 字",
    "feedback.submit.includeEnvironment": "附帶執行環境（版本、狀態、安裝目錄已去識別化）",
    "feedback.submit.env.launcher": "啟動器版本",
    "feedback.submit.env.game": "遊戲版本",
    "feedback.submit.env.path": "安裝目錄",
    "feedback.submit.send": "提交回報",
    "feedback.submit.sending": "正在提交…",
    "feedback.submit.created": "已提交為 #{number}，可以在列表裡看到它。",
    "feedback.submit.note": "提交後會公開在 GitHub 上；請不要在內容裡寫帳號或密碼。",
    "feedback.count.bug": "目前 BUG 數：{count}。",
    "feedback.count.suggestion": "目前建議數：{count}。",
    "feedback.comments": "{count} 則留言",
    "feedback.comments.title": "留言",
    "feedback.comments.empty": "還沒有留言",
    "feedback.compose.placeholder": "寫下你的補充或重現步驟…",
    "feedback.compose.send": "發表留言",
    "feedback.compose.sending": "正在發表…",
    "feedback.openOnGithub": "在 GitHub 開啟",
    "feedback.age.justNow": "剛剛",
    "feedback.age.minutes": "{count} 分鐘前",
    "feedback.age.hours": "{count} 小時前",
    "feedback.age.days": "{count} 天前",
    "feedback.category.bug": "BUG",
    "feedback.category.suggestion": "建議",
    "feedback.category.improvement": "優化",
    "feedback.category.question": "提問",
    "feedback.category.other": "未分類",
    "side.expand": "展開左側欄",
    "side.collapse": "收起左側欄",
    "install.title": "選擇安裝路徑",
    "install.migrationTitle": "選擇遷移路徑",
    "install.close": "關閉",
    "install.change": "更改",
    "install.requiredSpace": "所需空間",
    "install.availableSpace": "可用空間",
    "install.desktopShortcut": "桌面捷徑",
    "install.continue": "繼續安裝",
    "install.confirmMigration": "確認遷移",
    "space.querying": "正在查詢",
    "space.checking": "檢測中",
    "space.unavailable": "無法檢測",
    "confirm.deleteTitle": "刪除遊戲",
    "confirm.deleteBody": "將刪除目前遊戲目錄，並把啟動器狀態恢復到未下載。此操作不會卸載啟動器。",
    "confirm.delete": "刪除",
    "confirm.cancelDownloadTitle": "取消遊戲下載",
    "confirm.cancelDownloadBody": "將停止目前下載，並刪除已下載的遊戲碎片與快取。此操作不會刪除已安裝的遊戲。",
    "confirm.cancelDownload": "取消下載",
    "confirm.uninstallLauncherTitle": "卸載啟動器",
    "confirm.uninstallLauncherBody": "將先刪除目前遊戲目錄，再開啟系統卸載程式卸載啟動器本體。請確認已不需要保留本機檔案。",
    "confirm.uninstallLauncher": "卸載",
    "confirm.cancel": "取消",
    "dialog.chooseInstallPath": "選擇遊戲下載位置",
    "dialog.chooseGamePath": "選擇既有遊戲目錄",
    "dialog.chooseMigrationPath": "選擇新的遊戲安裝位置",
  },
  en: {
    "brand.title": "Crossing Void: Illusion Dreamland",
    "nav.quickLinks": "Quick links",
    "news.characters": "Characters",
    "news.notice": "Notices",
    "news.video": "Videos",
    "window.settings": "Settings",
    "window.minimize": "Minimize",
    "window.close": "Close",
    "action.checking": "Checking",
    "action.pauseDownload": "Pause",
    "action.cancelInstall": "Cancel install",
    "action.cancelVerification": "Cancel check",
    "action.cancelRepair": "Cancel repair",
    "action.cancelling": "Cancelling",
    "action.pauseUpload": "Pause upload",
    "action.resumeUpload": "Resume upload",
    "action.launchingGame": "Launching",
    "action.gameRunning": "Running",
    "action.launchGame": "Launch",
    "action.updateGame": "Update",
    "action.installGame": "Install",
    "action.installing": "Installing",
    "action.resumeDownload": "Resume",
    "action.downloadGame": "Download",
    "action.repairFiles": "Repair files",
    "action.updateLauncher": "Updating launcher",
    "action.updateLauncherReady": "Update launcher",
    "status.checking": "Checking manifest",
    "status.checkingFile": "Checking {file}",
    "status.verificationIssues": "{count} issue(s) found",
    "status.filesMissing": "Game files missing",
    "status.repairingFiles": "Repairing files",
    "status.repairPreparing": "Preparing repair data",
    "status.repairDownloading": "Downloading repair files",
    "status.repairWriting": "Writing repair files",
    "status.repairVerifying": "Verifying repaired files",
    "status.versionChecking": "Checking version",
    "status.launchingGame": "Launching game",
    "status.gameRunning": "Game running",
    "status.updateAvailable": "Update available",
    "status.launcherUpdateChecking": "Checking launcher update",
    "status.launcherUpdateAvailable": "Launcher update available",
    "status.launcherUpdateDownloading": "Updating launcher",
    "status.launcherUpdateInstalling": "Installing launcher update",
    "status.launcherUpdateRestarting": "Update complete, restarting launcher",
    "status.downloading": "Downloading",
    "download.estimateCalculating": "Calculating time remaining",
    "download.estimateStalled": "Download is not progressing",
    "download.estimatedRemaining": "About",
    "download.hour": " hr ",
    "download.minute": " min",
    "download.lessThanMinute": "less than 1 min",
    "status.downloaded": "Downloaded",
    "status.installing": "Installing",
    "installStage.merging": "Merging package",
    "installStage.verifying": "Verifying package",
    "installStage.extracting": "Extracting files",
    "installStage.finishing": "Finishing install",
    "installStage.patchDownloading": "Downloading patch",
    "installStage.patchApplying": "Applying patch",
    "status.ready": "Ready",
    "status.paused": "Paused",
    "status.waiting": "Waiting",
    "settings.preferences": "Preferences",
    "settings.download": "Download",
    "settings.game": "Game",
    "settings.about": "About",
    "settings.developer": "Developer",
    "settings.launcherLanguage": "Launcher Language",
    "settings.launcherLanguageHint": "Choose the display language used by the launcher.",
    "settings.runtime": "Runtime",
    "settings.closeWindow": "Close Window",
    "settings.exitLauncher": "Exit launcher",
    "settings.minimizeToTray": "Minimize to tray",
    "settings.display": "Display",
    "settings.hideAfterGameLaunch": "Do not show launcher after exiting game",
    "settings.downloadSource": "Download Source",
    "settings.autoSourceFallback": "Automatic source fallback",
    "settings.autoSourceFallbackHint": "Switch to the other source automatically when the preferred one fails, for a more reliable download. Turn it off to use only the source you picked.",
    "settings.githubUseSystemProxy": "Use system proxy for GitHub",
    "settings.githubUseSystemProxyHint": "Route GitHub through your system proxy. If your network can reach GitHub directly, turning this off is usually faster.",
    "settings.downloadSpeed": "Download Speed",
    "settings.cancelDownload": "Cancel Download",
    "settings.cancelDownloadHint": "Stop the current download and remove downloaded game chunks and cache.",
    "settings.unlimited": "Unlimited",
    "settings.limited": "Limited",
    "settings.installPath": "Game Install Path",
    "settings.openGameFolder": "Open game folder",
    "settings.relocateGame": "Relocate game",
    "settings.migrateGame": "Move game files",
    "settings.gameLog": "Game Logs",
    "settings.openGameLog": "Open game logs",
    "settings.gameManagement": "Game Management",
    "settings.deleteGame": "Delete game",
    "settings.uninstallLauncher": "Uninstall launcher",
    "settings.otherLaunchOptions": "Other Launch Options",
    "settings.autoRepair": "Auto repair resources",
    "settings.autoRepairHint": "Check missing files before launch and try to repair them",
    "settings.gameVersion": "Game version",
    "settings.aboutLauncher": "About Launcher",
    "settings.launcherVersion": "Launcher version",
    "settings.checkVersion": "Check version",
    "settings.checkingLauncherUpdate": "Checking launcher update",
    "settings.launcherUpdateReady": "Launcher update available",
    "settings.launcherLog": "Launcher Logs",
    "settings.openLogFolder": "Open log folder",
    "settings.termsPolicy": "Terms & Policies",
    "settings.userAgreement": "User Agreement",
    "settings.privacyPolicy": "Privacy Policy",
    "dev.setVersion": "Set version",
    "dev.versionHint": "The new version must be higher than the current version. Current version: {version}",
    "dev.packageLauncher": "Package launcher",
    "dev.publishLauncher": "Publish update package",
    "dev.openProjectFolder": "Open project folder",
    "dev.packageTitle": "Choose launcher package path",
    "dev.packagePath": "Package output folder",
    "dev.choosePath": "Change",
    "dev.cancel": "Cancel",
    "dev.startPackage": "Package",
    "dev.running": "Running",
    "downloadSource.official": "Crossing Void Source",
    "downloadSource.officialDesc": "Official server source with the fastest speed.",
    "downloadSource.github": "Github Source",
    "downloadSource.githubDesc": "Requires proxy access.",
    "traffic.title": "Available Server Download Traffic",
    "traffic.remaining": "Remaining",
    "traffic.expires": "Next expiry",
    "traffic.lowHint": "Server traffic is low. You can switch to the Github source to download.",
    "traffic.updating": "Checking server traffic quota…",
    "traffic.unavailable": "Traffic quota is temporarily unavailable. Downloads remain enabled.",
    "traffic.low": "Server traffic quota is low",
    "traffic.throttled": "The download source is throttled (monthly traffic used up). Downloads will be much slower.",
    "traffic.sourcePaused": "Server traffic quota is low. The official source download was paused.",
    "profile.featureCode": "Code",
    "profile.weeklyActive": "Weekly Active",
    "profile.resourceReserve": "Reserve",
    "profile.level": "Level",
    "profile.note": "Results may be delayed. Placeholder data is shown before the live API is connected.",
    "tool.more": "More",
    "tool.openLocalFiles": "Browse local files",
    "tool.verifyIntegrity": "Verify game integrity",
    "tool.checkUpdates": "Check updates again",
    "tool.offlineMode": "Offline mode",
    "tool.useDx11": "Launch with DX11",
    "quick.teamSite": "Team Site",
    "quick.teamSiteTip": "Visit team website",
    "quick.gameSite": "Game Site",
    "quick.gameSiteTip": "Visit game website",
    "quick.wiki": "Wiki",
    "quick.wikiTip": "Browse the wiki and reference docs",
    "quick.wechat": "WeChat",
    "quick.wechatTip": "Scan to follow WeChat",
    "quick.wechatQrAlt": "WeChat official account QR code",
    "quick.bilibili": "Bilibili",
    "quick.bilibiliTip": "Visit Bilibili homepage",
    "quick.bilibiliQrAlt": "Bilibili homepage QR code",
    "quick.qq": "QQ",
    "quick.qqTip": "Crossing Void Fan Group",
    "quick.qqQrAlt": "Crossing Void Fan Group QR code",
    "quick.bugReport": "Report a bug",
    "quick.bugReportTip": "Found a problem or have a suggestion? Tell us here",
    "feedback.title": "Player feedback",
    "feedback.loading": "Loading feedback…",
    "feedback.empty": "No open issues right now",
    "feedback.refresh": "Refresh",
    "feedback.close": "Close",
    "feedback.back": "Back to list",
    "feedback.filter.label": "Filter by category",
    "feedback.filter.all": "All",
    "feedback.filter.empty": "Nothing in this category yet",
    "feedback.submit.open": "Send feedback",
    "feedback.submit.category": "Which kind is it?",
    "feedback.submit.nickname": "Your nickname",
    "feedback.submit.nicknamePlaceholder": "How should we call you",
    "feedback.submit.nicknameHint": "Only used in this report; remembered for next time.",
    "feedback.submit.title": "One-line title",
    "feedback.submit.titlePlaceholder": "What were you doing when it broke, e.g. crashed after entering battle",
    "feedback.submit.titleCount": "{count} / 60 chars",
    "feedback.submit.description": "Details",
    "feedback.submit.descriptionPlaceholder": "What you did → what you expected → what happened",
    "feedback.submit.descriptionCount": "{count} chars",
    "feedback.submit.includeEnvironment": "Attach environment (versions, state; install path is redacted)",
    "feedback.submit.env.launcher": "Launcher",
    "feedback.submit.env.game": "Game",
    "feedback.submit.env.path": "Install path",
    "feedback.submit.send": "Submit",
    "feedback.submit.sending": "Submitting…",
    "feedback.submit.created": "Submitted as #{number}; it is now in the list.",
    "feedback.submit.note": "Your report will be public on GitHub. Never include account credentials.",
    "feedback.count.bug": "Open bugs: {count}.",
    "feedback.count.suggestion": "Open ideas: {count}.",
    "feedback.comments": "{count} comment(s)",
    "feedback.comments.title": "Comments",
    "feedback.comments.empty": "No comments yet",
    "feedback.compose.placeholder": "Add details or steps to reproduce…",
    "feedback.compose.send": "Post comment",
    "feedback.compose.sending": "Posting…",
    "feedback.openOnGithub": "Open on GitHub",
    "feedback.age.justNow": "just now",
    "feedback.age.minutes": "{count} min ago",
    "feedback.age.hours": "{count} h ago",
    "feedback.age.days": "{count} d ago",
    "feedback.category.bug": "BUG",
    "feedback.category.suggestion": "Idea",
    "feedback.category.improvement": "Improve",
    "feedback.category.question": "Question",
    "feedback.category.other": "Uncategorized",
    "side.expand": "Expand sidebar",
    "side.collapse": "Collapse sidebar",
    "install.title": "Choose Install Path",
    "install.migrationTitle": "Choose Migration Path",
    "install.close": "Close",
    "install.change": "Change",
    "install.requiredSpace": "Required",
    "install.availableSpace": "Available",
    "install.desktopShortcut": "Desktop shortcut",
    "install.continue": "Continue",
    "install.confirmMigration": "Move Game",
    "space.querying": "Querying",
    "space.checking": "Checking",
    "space.unavailable": "Unavailable",
    "confirm.deleteTitle": "Delete Game",
    "confirm.deleteBody": "Delete the current game folder and reset the launcher to the not-downloaded state. The launcher will not be uninstalled.",
    "confirm.delete": "Delete",
    "confirm.cancelDownloadTitle": "Cancel Game Download",
    "confirm.cancelDownloadBody": "Stop the current download and remove downloaded game chunks and cache. Installed game files will not be deleted.",
    "confirm.cancelDownload": "Cancel Download",
    "confirm.uninstallLauncherTitle": "Uninstall Launcher",
    "confirm.uninstallLauncherBody": "Delete the current game folder first, then open the system uninstaller for the launcher. Make sure you do not need to keep local files.",
    "confirm.uninstallLauncher": "Uninstall",
    "confirm.cancel": "Cancel",
    "dialog.chooseInstallPath": "Choose game download location",
    "dialog.chooseGamePath": "Choose existing game folder",
    "dialog.chooseMigrationPath": "Choose new game location",
  },
  ja: {
    "brand.title": "クロッシングヴォイド: 空界幻境",
    "nav.quickLinks": "クイックリンク",
    "news.characters": "キャラ",
    "news.notice": "お知らせ",
    "news.video": "動画",
    "window.settings": "設定",
    "window.minimize": "最小化",
    "window.close": "閉じる",
    "action.checking": "確認中",
    "action.pauseDownload": "一時停止",
    "action.cancelInstall": "インストールを中止",
    "action.cancelVerification": "確認を中止",
    "action.cancelRepair": "修復を中止",
    "action.cancelling": "中止しています",
    "action.pauseUpload": "アップロードを一時停止",
    "action.resumeUpload": "アップロードを再開",
    "action.launchingGame": "起動中",
    "action.gameRunning": "ゲーム実行中",
    "action.launchGame": "起動",
    "action.updateGame": "更新を取得",
    "action.installGame": "インストール",
    "action.installing": "インストール中",
    "action.resumeDownload": "再開",
    "action.downloadGame": "ダウンロード",
    "action.repairFiles": "ファイル修復",
    "action.updateLauncher": "ランチャー更新中",
    "action.updateLauncherReady": "ランチャーを更新",
    "status.checking": "リソース一覧を確認中",
    "status.checkingFile": "確認中 {file}",
    "status.verificationIssues": "異常 {count} 件",
    "status.filesMissing": "ゲームファイル不足",
    "status.repairingFiles": "ファイル修復中",
    "status.repairPreparing": "修復情報を準備中",
    "status.repairDownloading": "修復ファイルをダウンロード中",
    "status.repairWriting": "修復ファイルを書き込み中",
    "status.repairVerifying": "修復結果を確認中",
    "status.versionChecking": "バージョン確認中",
    "status.launchingGame": "ゲーム起動中",
    "status.gameRunning": "ゲーム実行中",
    "status.updateAvailable": "新バージョンあり",
    "status.launcherUpdateChecking": "ランチャー更新を確認中",
    "status.launcherUpdateAvailable": "ランチャー新バージョンあり",
    "status.launcherUpdateDownloading": "ランチャー更新中",
    "status.launcherUpdateInstalling": "ランチャー更新をインストール中",
    "status.launcherUpdateRestarting": "更新完了、ランチャーを再起動中",
    "status.downloading": "ダウンロード中",
    "download.estimateCalculating": "残り時間を計算中",
    "download.estimateStalled": "ダウンロードが進行していません",
    "download.estimatedRemaining": "残り約",
    "download.hour": "時間",
    "download.minute": "分",
    "download.lessThanMinute": "1分未満",
    "status.downloaded": "ダウンロード完了",
    "status.installing": "インストール中",
    "installStage.merging": "パッケージ結合中",
    "installStage.verifying": "パッケージ確認中",
    "installStage.extracting": "リソース展開中",
    "installStage.finishing": "インストール完了中",
    "installStage.patchDownloading": "パッチをダウンロード中",
    "installStage.patchApplying": "パッチを適用中",
    "status.ready": "準備完了",
    "status.paused": "一時停止中",
    "status.waiting": "待機中",
    "settings.preferences": "環境設定",
    "settings.download": "ダウンロード",
    "settings.game": "ゲーム",
    "settings.about": "情報",
    "settings.developer": "開発",
    "settings.launcherLanguage": "ランチャー言語",
    "settings.launcherLanguageHint": "ランチャー画面で使用する表示言語を選択します。",
    "settings.runtime": "起動設定",
    "settings.closeWindow": "ランチャーを閉じる",
    "settings.exitLauncher": "ランチャーを終了",
    "settings.minimizeToTray": "システムトレイに最小化",
    "settings.display": "表示設定",
    "settings.hideAfterGameLaunch": "ゲーム終了後にランチャーを表示しない",
    "settings.downloadSource": "ダウンロード元",
    "settings.autoSourceFallback": "自動でソースを切り替え",
    "settings.autoSourceFallbackHint": "優先ソースでのダウンロードに失敗したとき、もう一方のソースへ自動で切り替えて安定させます。オフにすると選択したソースだけを使います。",
    "settings.githubUseSystemProxy": "GitHub はシステムプロキシを使用",
    "settings.githubUseSystemProxyHint": "GitHub へのアクセスにシステムプロキシを使います。GitHub に直接接続できる環境では、オフにすると速くなることがあります。",
    "settings.downloadSpeed": "ダウンロード速度",
    "settings.cancelDownload": "ダウンロードを中止",
    "settings.cancelDownloadHint": "現在のダウンロードを停止し、ダウンロード済みのゲーム分割ファイルとキャッシュを削除します。",
    "settings.unlimited": "無制限",
    "settings.limited": "制限",
    "settings.installPath": "ゲームのインストール先",
    "settings.openGameFolder": "ゲームフォルダを開く",
    "settings.relocateGame": "ゲームを再指定",
    "settings.migrateGame": "ゲームファイルを移動",
    "settings.gameLog": "ゲームログ",
    "settings.openGameLog": "ゲームログを開く",
    "settings.gameManagement": "ゲーム管理",
    "settings.deleteGame": "ゲームを削除",
    "settings.uninstallLauncher": "ランチャーをアンインストール",
    "settings.otherLaunchOptions": "その他の起動オプション",
    "settings.autoRepair": "リソースを自動修復",
    "settings.autoRepairHint": "起動前に不足ファイルを確認し、修復を試みます",
    "settings.gameVersion": "ゲームバージョン",
    "settings.aboutLauncher": "ランチャー情報",
    "settings.launcherVersion": "ランチャーバージョン",
    "settings.checkVersion": "バージョン確認",
    "settings.checkingLauncherUpdate": "ランチャー更新を確認中",
    "settings.launcherUpdateReady": "ランチャー新バージョンあり",
    "settings.launcherLog": "ランチャーログ",
    "settings.openLogFolder": "ログフォルダを開く",
    "settings.termsPolicy": "規約とポリシー",
    "settings.userAgreement": "利用規約",
    "settings.privacyPolicy": "プライバシーポリシー",
    "dev.setVersion": "バージョン設定",
    "dev.versionHint": "新しいバージョンは現在のバージョンより高い必要があります。現在のバージョン：{version}",
    "dev.packageLauncher": "ランチャーをパッケージ",
    "dev.publishLauncher": "新バージョンを公開",
    "dev.openProjectFolder": "プロジェクトフォルダを開く",
    "dev.packageTitle": "ランチャー出力先を選択",
    "dev.packagePath": "出力フォルダ",
    "dev.choosePath": "変更",
    "dev.cancel": "キャンセル",
    "dev.startPackage": "開始",
    "dev.running": "実行中",
    "downloadSource.official": "零境交錯ソース",
    "downloadSource.officialDesc": "公式サーバーのダウンロード元です。速度が最も速いです。",
    "downloadSource.github": "Githubソース",
    "downloadSource.githubDesc": "プロキシが必要です。",
    "traffic.title": "サーバーの利用可能なダウンロード通信量",
    "traffic.remaining": "残り通信量",
    "traffic.expires": "直近の有効期限",
    "traffic.lowHint": "サーバー通信量が不足しています。Githubソースに切り替えてダウンロードできます。",
    "traffic.updating": "サーバー通信量を確認しています…",
    "traffic.unavailable": "通信量を取得できません。ダウンロードは引き続き利用できます。",
    "traffic.low": "サーバーの通信量が不足しています",
    "traffic.throttled": "ダウンロード元の通信量を使い切ったため帯域制限中です。ダウンロードが大幅に遅くなります。",
    "traffic.sourcePaused": "サーバーの通信量不足により、公式ソースのダウンロードを一時停止しました。",
    "profile.featureCode": "識別コード",
    "profile.weeklyActive": "週間活躍",
    "profile.resourceReserve": "備蓄",
    "profile.level": "レベル",
    "profile.note": "結果には遅延がある場合があります。正式 API 接続前は仮データを表示します。",
    "tool.more": "その他",
    "tool.openLocalFiles": "ローカルファイルを開く",
    "tool.verifyIntegrity": "ゲーム整合性を確認",
    "tool.checkUpdates": "更新を再確認",
    "tool.offlineMode": "オフラインで遊ぶ",
    "tool.useDx11": "DX11で起動",
    "quick.teamSite": "チーム公式",
    "quick.teamSiteTip": "チーム公式サイトへ",
    "quick.gameSite": "ゲーム公式",
    "quick.gameSiteTip": "ゲーム公式サイトへ",
    "quick.wiki": "Wiki",
    "quick.wikiTip": "Wiki・資料サイトを見る",
    "quick.wechat": "WeChat",
    "quick.wechatTip": "WeChat 公式をフォロー",
    "quick.wechatQrAlt": "WeChat 公式 QR コード",
    "quick.bilibili": "Bilibili",
    "quick.bilibiliTip": "Bilibili ホームへ",
    "quick.bilibiliQrAlt": "Bilibili ホーム QR コード",
    "quick.qq": "QQ",
    "quick.qqTip": "零境交錯ファングループ",
    "quick.qqQrAlt": "零境交錯ファングループ QR コード",
    "quick.bugReport": "不具合報告",
    "quick.bugReportTip": "問題や要望があればこちらへ",
    "feedback.title": "プレイヤー報告",
    "feedback.loading": "報告を読み込み中…",
    "feedback.empty": "未対応の報告はありません",
    "feedback.refresh": "更新",
    "feedback.close": "閉じる",
    "feedback.back": "一覧へ戻る",
    "feedback.filter.label": "分類で絞り込む",
    "feedback.filter.all": "すべて",
    "feedback.filter.empty": "この分類にはまだ何もありません",
    "feedback.submit.open": "報告する",
    "feedback.submit.category": "どれに当てはまりますか？",
    "feedback.submit.nickname": "ニックネーム",
    "feedback.submit.nicknamePlaceholder": "表示される名前",
    "feedback.submit.nicknameHint": "この報告にだけ書かれ、次回から自動で入ります。",
    "feedback.submit.title": "一行タイトル",
    "feedback.submit.titlePlaceholder": "どんな時に起きたか（例：戦闘に入ると落ちる）",
    "feedback.submit.titleCount": "{count} / 60 文字",
    "feedback.submit.description": "詳しい説明",
    "feedback.submit.descriptionPlaceholder": "したこと → 期待したこと → 実際に起きたこと",
    "feedback.submit.descriptionCount": "{count} 文字",
    "feedback.submit.includeEnvironment": "実行環境を添付（バージョン・状態、インストール先は伏せ字）",
    "feedback.submit.env.launcher": "ランチャー",
    "feedback.submit.env.game": "ゲーム",
    "feedback.submit.env.path": "インストール先",
    "feedback.submit.send": "送信",
    "feedback.submit.sending": "送信中…",
    "feedback.submit.created": "#{number} として送信しました。一覧に表示されます。",
    "feedback.submit.note": "送信内容は GitHub で公開されます。アカウント情報は書かないでください。",
    "feedback.count.bug": "現在の BUG 数：{count}。",
    "feedback.count.suggestion": "現在の要望数：{count}。",
    "feedback.comments": "コメント {count} 件",
    "feedback.comments.title": "コメント",
    "feedback.comments.empty": "コメントはまだありません",
    "feedback.compose.placeholder": "補足や再現手順を書いてください…",
    "feedback.compose.send": "コメントを投稿",
    "feedback.compose.sending": "投稿中…",
    "feedback.openOnGithub": "GitHub で開く",
    "feedback.age.justNow": "たった今",
    "feedback.age.minutes": "{count} 分前",
    "feedback.age.hours": "{count} 時間前",
    "feedback.age.days": "{count} 日前",
    "feedback.category.bug": "BUG",
    "feedback.category.suggestion": "要望",
    "feedback.category.improvement": "改善",
    "feedback.category.question": "質問",
    "feedback.category.other": "未分類",
    "side.expand": "左サイドバーを展開",
    "side.collapse": "左サイドバーを折りたたむ",
    "install.title": "インストール先を選択",
    "install.migrationTitle": "移行先を選択",
    "install.close": "閉じる",
    "install.change": "変更",
    "install.requiredSpace": "必要容量",
    "install.availableSpace": "空き容量",
    "install.desktopShortcut": "デスクトップショートカット",
    "install.continue": "続行",
    "install.confirmMigration": "移行する",
    "space.querying": "確認中",
    "space.checking": "確認中",
    "space.unavailable": "確認できません",
    "confirm.deleteTitle": "ゲームを削除",
    "confirm.deleteBody": "現在のゲームフォルダーを削除し、ランチャー状態を未ダウンロードに戻します。ランチャーはアンインストールされません。",
    "confirm.delete": "削除",
    "confirm.cancelDownloadTitle": "ゲームのダウンロードを中止",
    "confirm.cancelDownloadBody": "現在のダウンロードを停止し、ダウンロード済みのゲーム分割ファイルとキャッシュを削除します。インストール済みのゲームは削除されません。",
    "confirm.cancelDownload": "ダウンロードを中止",
    "confirm.uninstallLauncherTitle": "ランチャーをアンインストール",
    "confirm.uninstallLauncherBody": "現在のゲームフォルダーを削除してから、ランチャーのアンインストーラーを開きます。ローカルファイルを保持する必要がないことを確認してください。",
    "confirm.uninstallLauncher": "アンインストール",
    "confirm.cancel": "キャンセル",
    "dialog.chooseInstallPath": "ゲームのダウンロード先を選択",
    "dialog.chooseGamePath": "既存のゲームフォルダを選択",
    "dialog.chooseMigrationPath": "新しいゲーム保存先を選択",
  },
};

export function isLauncherLanguage(value: string | null): value is LauncherLanguage {
  return value === "zh-Hans" || value === "zh-Hant" || value === "en" || value === "ja";
}

export function translate(
  language: LauncherLanguage,
  key: TranslationKey,
  replacements?: Record<string, string | number>,
) {
  const text = translations[language][key] ?? translations["zh-Hans"][key] ?? key;
  if (!replacements) return text;
  // 占位符写法与已有文案一致（如 `发现异常 {count} 项`）。
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in replacements ? String(replacements[name]) : match,
  );
}
