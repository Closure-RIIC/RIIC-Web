import { helpKnowledgeText } from "../i18n/helpers/help_knowledge.ts";

export type DocText = readonly [zh: string, en: string];
export const docText = (value: DocText, locale: string) => value[locale === "en" ? 1 : 0];
export type DocGroup = "start" | "scheduling" | "features" | "faq" | "account";
export interface DocSection {
  id: string;
  title: DocText;
  paragraphs?: DocText[];
  steps?: DocText[];
}
export interface DocArticle {
  slug: string;
  group: DocGroup;
  title: DocText;
  description: DocText;
  sections: DocSection[];
  related?: string[];
  action?: { href: string; label: DocText };
  kind?: "import" | "videos" | "faq";
  knowledgeId?: "maa" | "box" | "filler" | "shifts" | "drones" | "fiammetta" | "dorm" | "busy";
}

export const DOC_GROUPS: { id: DocGroup; title: DocText; description: DocText }[] = [
  { id: "start", title: ["开始使用", "Getting started"], description: ["从导入干员，到生成你的第一份排班。", "From importing operators to your first base schedule."] },
  { id: "scheduling", title: ["排班与基建", "Scheduling & base"], description: ["理解轮换机制，调整适合自己的基建方案。", "Understand rotations and adapt your base plan."] },
  { id: "features", title: ["功能指南", "Feature guides"], description: ["了解账号体检、养成规划和助理的使用方式。", "Explore account health, training plans, and the assistant."] },
  { id: "faq", title: ["常见问题", "Troubleshooting"], description: ["遇到问题，从现象出发找到解决步骤。", "Find an answer starting with the problem you see."] },
  { id: "account", title: ["账号与设置", "Account & settings"], description: ["管理登录、设备、数据与积分。", "Manage sign-in, devices, data, and credits."] },
];

const knowledge = (id: NonNullable<DocArticle["knowledgeId"]>, slug: string, group: DocGroup, title: DocText, related: string[]): DocArticle => ({
  slug, group, title, related, knowledgeId: id,
  description: [helpKnowledgeText.text(false, `${id}Question`), helpKnowledgeText.text(true, `${id}Question`)],
  sections: [{ id: "answer", title: ["说明与处理方法", "Explanation & next steps"], paragraphs: [[helpKnowledgeText.text(false, `${id}Answer`), helpKnowledgeText.text(true, `${id}Answer`)]] }],
});

export const DOC_ARTICLES: DocArticle[] = [
  {
    slug: "first-import", group: "start", kind: "import", title: ["首次导入", "Your first import"],
    description: ["把自己的干员数据导入终端，再生成适合你的基建排班。按顺序完成下面五步即可。", "Import your own operators before creating a base schedule. Follow these five steps to get started."],
    sections: [
      { id: "open-settings", title: ["打开配置入口", "Open setup"] },
      { id: "change-box", title: ["更换干员数据", "Replace the Operator Box"] },
      { id: "choose-source-in-app", title: ["选择数据来源", "Choose a data source"] },
      { id: "import-methods", title: ["森空岛或 MAA 导入", "Import with Skland or MAA"] },
      { id: "finish", title: ["保存并生成排班", "Save and generate"] },
    ], related: ["first-schedule", "export-maa", "faq-box"],
  },
  {
    slug: "skland-sync", group: "start", title: ["森空岛同步", "Skland sync"],
    description: ["通过森空岛读取角色与基建数据，减少手动填写。", "Read your operators and base data through Skland."],
    sections: [
      { id: "connect", title: ["连接角色", "Connect a character"], steps: [["打开「森空岛同步」，选择扫码登录或凭证导入。", "Open Skland sync and choose QR login or credential import."], ["按页面提示确认协议并完成授权，再选择需要使用的游戏角色。", "Confirm the agreements and authorization, then select the game character you want to use."], ["等待同步完成，核对角色、区服与干员数据。", "Wait for sync to finish and check the character, server, and operator data."]] },
      { id: "apply", title: ["用于排班", "Use the data for scheduling"], paragraphs: [["回到「配置 Box 与布局」，选择森空岛来源并应用数据。核对设施等级和轮换设置，保存后重新生成排班。", "In Box & Layout setup, choose Skland and apply its data. Check facility levels and rotation settings, save, and generate a new schedule."]] },
      { id: "refresh", title: ["同步与授权过期", "Refreshing expired authorization"], paragraphs: [["角色数据变化后重新同步。授权失效时，按页面提示重新登录森空岛；网站账号登录与森空岛授权是两个独立步骤。", "Sync again after your character data changes. If authorization expires, sign in to Skland again. Website sign-in and Skland authorization are separate steps."]] },
    ], related: ["first-import", "faq-sync"], action: { href: "/skland", label: ["打开森空岛同步", "Open Skland sync"] },
  },
  {
    slug: "maa-import", group: "start", title: ["MAA 文件导入", "Import from MAA"],
    description: ["使用 MAA 导出的干员文件，将已持有干员与练度带入排班。", "Import the operators you own and their levels from a MAA export."],
    sections: [
      { id: "export", title: ["准备干员文件", "Prepare an operator file"], paragraphs: [["在 MAA 中完成干员识别与导出，找到 Arknights_OperBox_Export.json。干员 Box 文件和基建排班 JSON 用途不同，请选择干员导出文件。", "Recognize and export your operators in MAA, then locate Arknights_OperBox_Export.json. Operator Box files and base schedule JSON files serve different purposes; select the operator export."]] },
      { id: "upload", title: ["导入并保存", "Import and save"], steps: [["打开「配置 Box 与布局」，回到「干员数据」步骤。", "Open Box & Layout setup and select the Operator Data step."], ["选择 MAA 来源，上传文件或粘贴导出的 JSON。", "Choose MAA, then upload the file or paste the exported JSON."], ["核对干员数量与练度，完成布局配置并保存。", "Check the operator count and levels, finish the layout setup, and save."], ["重新生成排班，让新 Box 参与计算。", "Generate a new schedule to use the imported Box."]] },
    ], related: ["first-import", "first-schedule", "video-tutorials"],
  },
  {
    slug: "first-schedule", group: "start", title: ["生成第一份排班", "Create your first schedule"],
    description: ["确认干员、布局和轮换设置，再查看每一班的安排。", "Check your operators, layout, and rotation before reviewing each shift."],
    sections: [
      { id: "prepare", title: ["生成前检查", "Before you generate"], steps: [["确认 Box 是自己的干员数据，而不是全角色示例。", "Use your own Operator Box rather than the all-operator sample."], ["核对制造站、贸易站、发电站与宿舍的数量和等级。", "Verify factory, trading post, power plant, and dormitory counts and levels."], ["选择适合自己上线频率的轮换方式；修改后保存配置。", "Choose a rotation that fits your play schedule and save the configuration."]] },
      { id: "generate", title: ["生成与核对", "Generate and review"], paragraphs: [["提交一次生成请求，等待当前任务完成。切换各班查看干员、房间产物、无人机安排和宿舍；需要局部调整时进入手动排班。", "Submit one generation request and wait for it to finish. Review each shift, its operators, products, drones, and dormitories. Use manual scheduling for individual adjustments."], ["修改 Box、布局或开关不会自动重算已有结果。保存修改后，需要重新生成。", "Changing the Box, layout, or options does not recalculate an existing result. Save your changes and generate again."]] },
    ], action: { href: "/", label: ["打开自动排班", "Open automatic scheduling"] }, related: ["export-maa", "manual-schedule", "shifts"],
  },
  knowledge("maa", "export-maa", "start", ["导出到 MAA", "Export to MAA"], ["first-schedule", "dormitories", "video-tutorials"]),
  { slug: "video-tutorials", group: "start", kind: "videos", title: ["视频教程", "Video tutorials"], description: ["跟着演示学习 Box 导入、MAA 导出、手动排班与换班。", "Watch operator imports, MAA exports, manual scheduling, and shift changes."], sections: [{ id: "videos", title: ["教程列表", "Tutorials"] }], related: ["first-import", "manual-schedule"] },
  {
    slug: "manual-schedule", group: "scheduling", title: ["手动排班", "Manual scheduling"],
    description: ["按房间和班次调整方案，并在导出前核对安排。", "Adjust rooms and shifts, then review the result before exporting."],
    sections: [
      { id: "edit", title: ["编辑方案", "Edit a schedule"], steps: [["打开手动排班，选择需要编辑的班次和房间。", "Open manual scheduling and select the shift and room to edit."], ["按自己的干员池选择成员，检查同班房间间的人员冲突。", "Choose operators from your Box and check for conflicting assignments in the same shift."], ["根据需求调整房间产物、轮换与无人机目标。", "Adjust room products, rotations, and drone targets as needed."]] },
      { id: "review", title: ["评估与导出", "Evaluate and export"], paragraphs: [["编辑后重新查看评估结果与心情变化。确认所有班次、宿舍和导出配置后，再将方案交给 MAA 执行。", "Review the evaluation and morale changes after editing. Check every shift, dormitory, and export setting before using the schedule in MAA."]] },
    ], related: ["shifts", "drones", "export-maa"], action: { href: "/manual", label: ["打开手动排班", "Open manual scheduling"] },
  },
  knowledge("shifts", "shifts", "scheduling", ["班次与轮换", "Shifts & rotations"], ["first-schedule", "manual-schedule"]),
  knowledge("drones", "drones", "scheduling", ["无人机安排", "Drone allocation"], ["manual-schedule", "export-maa"]),
  knowledge("fiammetta", "fiammetta", "scheduling", ["菲亚梅塔", "Fiammetta"], ["shifts", "first-schedule"]),
  knowledge("dorm", "dormitories", "scheduling", ["宿舍与换班顺序", "Dormitories & execution order"], ["export-maa", "manual-schedule"]),
  {
    slug: "operators", group: "features", title: ["我的角色与干员数据", "Characters & operators"], description: ["查看当前使用的角色，理解干员数据与排班结果的关系。", "Check your active character and understand how operator data affects scheduling."],
    sections: [{ id: "source", title: ["核对来源", "Check the source"], paragraphs: [["排班使用当前配置里的 Box。切换森空岛角色或导入新的 MAA 文件后，先确认干员数据已经应用，再生成新的排班。", "Scheduling uses the Box in your current configuration. After switching Skland characters or importing a new MAA file, apply the operator data before generating again."]] }, { id: "levels", title: ["练度变化", "Changes in operator levels"], paragraphs: [["精英阶段等练度变化会影响可用基建技能。游戏内培养干员后，重新同步或导入，让终端使用最新数据。", "Promotion and other level changes can affect available base skills. Sync or import again after upgrading operators in the game."]] }], related: ["skland-sync", "maa-import", "faq-box"],
  },
  {
    slug: "account-health", group: "features", title: ["账号体检", "Account health"], description: ["结合干员、库存与使用偏好，查看基建相关建议。", "Review base recommendations using your operators, inventory, and preferences."],
    sections: [{ id: "data", title: ["先确认数据", "Check your data first"], paragraphs: [["检查当前角色与数据来源。数据缺失或陈旧时，先完成同步；建议的有效性取决于本次可用的数据。", "Check the active character and data source. Sync missing or outdated data first; recommendations depend on the data available."]] }, { id: "preferences", title: ["填写使用偏好", "Set your preferences"], paragraphs: [["只填写已经确定的基建使用偏好。不确定的项目保留「未设置」，再结合自己的资源与日常安排阅读建议。", "Fill in preferences you have already settled on. Leave uncertain choices unspecified, then consider recommendations alongside your resources and routine."]] }], action: { href: "/account-health", label: ["打开账号体检", "Open account health"] }, related: ["training-plan", "skland-sync"],
  },
  {
    slug: "training-plan", group: "features", title: ["养成规划", "Training plans"], description: ["设置目标练度，查看材料缺口、加工方案和钱书需求。", "Set target levels and review material gaps, crafting, LMD, and experience needs."],
    sections: [{ id: "goals", title: ["设置目标", "Set your goals"], steps: [["选择准备培养的干员，核对当前精英阶段、等级、技能和模组。", "Select operators and check their current promotion, level, skills, and modules."], ["设置目标练度，并确认使用的库存属于当前角色。", "Set target levels and make sure the inventory belongs to the active character."]] }, { id: "gaps", title: ["阅读缺口", "Read the gaps"], paragraphs: [["查看扣除库存后的材料需求与加工方案。按日产出估算的钱书时间用于辅助安排；库存或目标变化后重新核对结果。", "Review material gaps after inventory and the crafting plan. LMD and experience time estimates help planning; review them again when inventory or goals change."]] }], related: ["account-health", "skland-sync"], action: { href: "/training-plan", label: ["打开养成规划", "Open training plans"] },
  },
  {
    slug: "gacha-analysis", group: "features", title: ["抽卡分析", "Headhunting analysis"], description: ["导入寻访记录，按卡池查看自己的抽卡情况。", "Import headhunting records and review them by banner."],
    sections: [{ id: "import", title: ["导入记录", "Import records"], paragraphs: [["打开抽卡分析，按页面提供的登录或导入方式获取记录，确认对应的账号与区服。", "Open headhunting analysis and use the available sign-in or import method. Check the account and server."]] }, { id: "coverage", title: ["确认统计范围", "Check the coverage"], paragraphs: [["统计基于已经导入的记录。留意记录的时间范围与卡池筛选；缺少历史记录时，图表不能代表账号全部的抽卡历史。", "Statistics use the records you have imported. Check the date range and banner filters; missing records mean charts cannot represent the entire account history."]] }], action: { href: "/gacha", label: ["打开抽卡分析", "Open headhunting analysis"] }, related: ["account-data"],
  },
  {
    slug: "assistant", group: "features", title: ["可露希尔助理", "Closure assistant"], description: ["在当前页面提问，或打开完整对话查看历史记录。", "Ask from your current page or open the full chat and history."],
    sections: [{ id: "context", title: ["带着页面内容提问", "Ask about the current page"], paragraphs: [["点击页面上的助理入口，查看正在共享的页面摘要。需要单独提问时，关闭「随消息共享当前页面摘要」。", "Open the floating assistant and review the shared page summary. Turn off page-summary sharing when asking an unrelated question."]] }, { id: "history", title: ["新对话与历史", "New chats & history"], paragraphs: [["刷新页面会开始新的活动会话；已保存的对话仍可从历史记录打开。生成新的自动排班后，也会开始新会话。", "Reloading starts a fresh active chat; saved conversations remain available in history. Generating a new automatic schedule also starts a new conversation."]] }, { id: "access", title: ["使用条件", "Availability"], paragraphs: [["助理入口由账号权限和功能开放状态决定。提示积分不足时，可从提示中的入口查看付费计划。不要在消息中粘贴密码或森空岛凭证。", "Assistant access depends on your account permissions and feature availability. If credits are required, follow the payment-plan link in the message. Do not paste passwords or Skland credentials into chats."]] }], related: ["credits", "account-login"],
  },
  { slug: "faq", group: "faq", kind: "faq", title: ["常见问题总览", "Common questions"], description: ["先找到你遇到的现象，再按对应文档逐项排查。", "Find the symptom you see, then follow the corresponding guide."], sections: [{ id: "questions", title: ["问题列表", "Questions"] }], related: ["first-import"] },
  knowledge("box", "faq-box", "faq", ["结果里有未持有的干员", "Unowned operators in results"], ["first-import", "maa-import", "skland-sync"]),
  {
    slug: "faq-box-not-applied", group: "faq", title: ["换了 Box，结果没变", "Results unchanged after import"], description: ["已有结果不会随着新导入的干员数据自动更新。", "Existing results do not automatically update after importing new operator data."],
    sections: [{ id: "resolve", title: ["重新应用并生成", "Apply and generate again"], steps: [["打开配置，确认来源已从示例切换为自己的 Box。", "Open setup and check that the source is your own Box rather than a sample."], ["点击「完成」保存，回到自动排班重新生成。", "Save with Finish, then return to automatic scheduling and generate again."], ["仍不一致时，核对角色、区服和文件导出时间，再重新同步或导入。", "If results still differ, check the character, server, and export date, then sync or import again."]] }], related: ["faq-box", "first-schedule"],
  },
  {
    slug: "faq-saved-box", group: "faq", title: ["配置直接进入第 2 步", "Setup starts at step 2"], description: ["浏览器已有保存的 Box 时，可以直接继续布局配置。", "With a saved Box, setup can continue directly to the layout step."],
    sections: [{ id: "resolve", title: ["回到干员数据", "Return to operator data"], paragraphs: [["在配置弹窗顶部点击第 1 步「干员数据」，再点击「更换」选择新的来源。这不会要求你清除整个浏览器的数据。", "Select step 1, Operator Data, at the top of the setup dialog. Choose Replace to select a new source; clearing all browser data is unnecessary."]] }], related: ["first-import", "faq-box-not-applied"],
  },
  knowledge("filler", "faq-filler", "faq", ["没有对应技能却被排班", "Operators without matching skills"], ["first-schedule", "manual-schedule"]),
  knowledge("busy", "faq-busy", "faq", ["请求繁忙或求解失败", "Busy requests or failed solves"], ["first-schedule", "account-login"]),
  {
    slug: "faq-sync", group: "faq", title: ["森空岛同步失败", "Skland sync fails"], description: ["从登录状态、角色选择和数据更新时间开始排查。", "Check authorization, character selection, and the last data update."],
    sections: [{ id: "resolve", title: ["排查步骤", "Troubleshooting steps"], steps: [["阅读页面提示。网站账号未登录时先登录网站；森空岛授权过期时重新扫码或导入有效凭证。", "Read the message. Sign in to the website if required; renew expired Skland authorization with a QR login or valid credential."], ["确认选择的角色与区服正确，然后重新同步一次。", "Check the character and server, then sync once more."], ["遇到频率限制先等待，不要连续重复提交。", "Wait when rate-limited instead of submitting repeatedly."]] }, { id: "report", title: ["仍然失败", "If it still fails"], paragraphs: [["反馈时提供发生时间、错误信息与请求编号，并说明哪一步失败。请隐藏凭证、密码和其他私密信息。", "Include the time, error, request ID, and failing step when reporting. Hide credentials, passwords, and other private information."]] }], related: ["skland-sync", "faq-busy"],
  },
  {
    slug: "account-login", group: "account", title: ["登录与设备管理", "Sign-in & devices"], description: ["管理网站登录，并区分网站账号和游戏角色授权。", "Manage website sessions separately from game-character authorization."],
    sections: [{ id: "sign-in", title: ["登录网站账号", "Sign in to the website"], paragraphs: [["通过侧边栏底部的账号入口登录。忘记密码时使用登录界面的密码重置入口，按邮件指引完成操作。", "Use the account control at the bottom of the sidebar to sign in. If you forget your password, use password reset in the sign-in interface and follow the email instructions."]] }, { id: "devices", title: ["查看登录设备", "Review signed-in devices"], paragraphs: [["在设置页的账号相关区域管理资料和登录设备。发现不认识的登录记录时，撤销相关会话，并修改密码。", "Manage your profile and signed-in devices in Settings. Revoke unfamiliar sessions and change your password."]] }], related: ["account-data", "skland-sync"], action: { href: "/settings", label: ["打开设置", "Open settings"] },
  },
  {
    slug: "account-data", group: "account", title: ["数据保存与设置", "Saved data & settings"], description: ["了解本地数据与账号功能，避免误删自己的配置。", "Understand local data and account features before clearing configurations."],
    sections: [{ id: "local", title: ["浏览器中的数据", "Data in your browser"], paragraphs: [["本地导入的配置、使用偏好等会保存在当前浏览器。更换浏览器、使用无痕模式或清除网站数据，可能无法继续使用这些本地内容。", "Imported configurations and preferences are stored in the current browser. Switching browsers, private browsing, or clearing site data can make that local content unavailable."]] }, { id: "cloud", title: ["云端数据与删除", "Cloud data & deletion"], paragraphs: [["账号云端相关能力以页面实际提供的功能和授权状态为准。不要把登录账号当作所有本地数据都已备份；删除或清理前，先导出需要保留的方案。", "Cloud features depend on what the page offers and your consent. Signing in does not mean all local data is backed up. Export schedules you need before deleting or clearing data."]] }, { id: "preferences", title: ["界面偏好", "Interface preferences"], paragraphs: [["在设置页管理显示与资源加载选项。中英文切换沿用当前浏览器偏好；关闭英文资源后，需要先在设置中重新开启才能切换英文。", "Manage display and resource-loading options in Settings. Language follows your browser preferences; if English resources are disabled, enable them in Settings before switching to English."]] }], related: ["account-login"], action: { href: "/settings", label: ["打开设置", "Open settings"] },
  },
  {
    slug: "credits", group: "account", title: ["积分与付费计划", "Credits & payment plans"], description: ["查看账号积分和当前可用的付费方案。", "Review account credits and available payment plans."],
    sections: [{ id: "plans", title: ["查看计划与余额", "View plans & balance"], paragraphs: [["登录后，从账号菜单进入付费计划。价格、权益、积分消耗和支付状态以当前页面显示为准。", "After signing in, open Payment plans from the account menu. The live page is the source for prices, benefits, credit usage, and payment status."]] }, { id: "balance", title: ["提示积分不足", "When credits are insufficient"], paragraphs: [["先确认当前登录的是正确账号，再查看余额和订单状态。支付结果尚未确认时，先等待并刷新订单状态，避免重复购买。", "Check the signed-in account, balance, and order status. If payment is not yet confirmed, wait and refresh the order status before buying again."]] }], related: ["assistant", "account-login"],
  },
];

export const findDoc = (slug: string) => DOC_ARTICLES.find(article => article.slug === slug);

/** Search the small public document catalogue, without loading application data. */
export function searchDocs(query: string, locale: string) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return DOC_ARTICLES.slice(0, 6);
  return DOC_ARTICLES.map(article => {
    const title = article.title.join(" ").toLocaleLowerCase();
    const body = [article.slug, ...article.description, ...article.sections.flatMap(section => [...section.title, ...(section.paragraphs ?? []).flat(), ...(section.steps ?? []).flat()])].join(" ").toLocaleLowerCase();
    const score = terms.every(term => title.includes(term) || body.includes(term))
      ? terms.reduce((sum, term) => sum + (docText(article.title, locale).toLocaleLowerCase().includes(term) ? 8 : title.includes(term) ? 4 : 1), 0) : 0;
    return { article, score };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score).map(item => item.article);
}
