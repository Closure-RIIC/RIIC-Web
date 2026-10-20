import { PageTitle, Section } from "@shared/endfield-ui";
import { Link } from "@tanstack/react-router";
import { useWorkspace } from "../state";
import { RosterDialogTrigger } from "./RosterDialog";
export function DocsPage() {
  const { t } = useWorkspace();
  return <div className="ef-page ef-document"><PageTitle title={t("终末地使用文档", "Endfield docs")} subtitle={t("从名单到下一轮换班。", "From your roster to the next shift.")} />
    <Section title={t("第一次排班", "Your first schedule")}><p>{t("点击首页“编辑名单”，筛选并勾选已有干员，填写精英化阶段。新勾选的干员默认精英化 0。", "Use Edit roster to filter and select your operators and elite stages. Newly selected operators start at elite 0.")}</p><p>{t("森空岛同步会自动更新设施等级，也可在手动排班中调整。首页点击“生产配置”，设置制造产物、培养位分配与中枢助力，并拖动四张目标卡调整优先级。修改自动保存，生产配置与手动排班共用。", "Skland sync updates facility levels automatically; you can also adjust them in manual scheduling. Open Production setup to choose production types, growth plots and central assistance, and drag the four goal cards to set priorities. Changes are saved automatically; production choices are shared with manual scheduling.")}</p><p><RosterDialogTrigger className="ef-text-action">{t("开始配置干员 →", "Set up your roster →")}</RosterDialogTrigger></p></Section>
    <Section title={t("如何阅读结果", "Reading results")}><p>{t("设施总览中同时展示两班头像与各自时间：A 班从 00:00 工作到换班时刻，B 班接续到 24:00。单班显示工作和休息时长。点击“详细报告”查看心情闭环、模拟结果或导出方案。", "The facility overview shows both shifts and their times: shift A starts at 00:00; shift B runs from the changeover to 24:00. Single-shift schedules show work and rest durations. Open Full report for morale cycles, simulations and export.")}</p><p>{t("产出使用等效小时 / 日，不等同于物品数量。校验通过表示人员、工位和重算结果一致，不代表全局最优。搜索达到预算上限时，结果仅是已搜索范围内的候选。", "Output is expressed as effective hours per day, not item counts. Verification checks crew, capacity and recalculated output, not global optimality. A budget-limited result is the best candidate found in that search.")}</p></Section>
    <Section title={t("森空岛同步", "Skland sync")}>
      <p>{t("打开侧边栏“森空岛同步”，扫码登录或导入凭证，也可复用方舟已连接的森空岛账号。登录后自动展示角色信息、理智、每日任务、通行证、干员与武器状态、仓库背包和帝江号。通过“添加账号”连接其他账号，已连接账号刷新后自动恢复。", "Open Skland sync and sign in with QR or a credential, or reuse an Arknights Skland account. View your profile, sanity, daily missions, battle pass, operators, weapons, inventory and ship. Use Add account to connect another account; saved connections restore after refresh.")}</p>
      <p>{t("同步会自动更新可用的设施等级，并按新容量调整培养位和手动班表；制造产物和仍符合容量的配置会保留。设施数据不完整时保留原配置。排班干员名单请在首页“编辑名单”中设置，同步不会覆盖名单。", "Sync applies valid facility levels and adjusts growth plots and manual slots to fit. Production choices and compatible assignments are retained; incomplete facility data keeps the previous setup. Configure scheduling operators in Edit roster on the home page; syncing does not replace that roster.")}</p>
      <p><Link to="/skland">{t("打开森空岛同步 →", "Open Skland sync →")}</Link></p>
    </Section>
    <Section title={t("常见问题", "FAQ")}>
      <details><summary>{t("切换游戏会丢失名单吗？", "Will switching games erase my roster?")}</summary><p>{t("两个游戏的草稿分别存储在各自域名的本地存储中。当前终末地名单保存在这台浏览器中，可导出 JSON 备份。它不会自动上传到账号云端。", "Each game keeps separate local drafts. This Endfield roster is stored in your browser and can be exported as JSON. It is not automatically uploaded to your account.")}</p></details>
      <details><summary>{t("为什么没有生成结果？", "Why was no result generated?")}</summary><p>{t("先检查两班人员是否足够、手动排班中的设施配置是否合适。搜索默认使用 5 秒、20 万节点；需要时可在设置页“排班搜索”中增加预算。", "Check that you have enough operators for both shifts and suitable facilities in manual scheduling. Search defaults to 5 seconds and 200,000 nodes; increase the budget in Settings → Scheduling search when needed.")}</p></details>
      <details><summary>{t("可以使用明日方舟的导入文件吗？", "Can I import an Arknights file?")}</summary><p>{t("不能。请在“编辑名单”中选择终末地干员。森空岛同步可以复用方舟已连接的账号来查看终末地数据。", "No. Select Endfield operators in Edit roster. Skland sync can reuse an account connected in Arknights to view Endfield data.")}</p></details>
    </Section>
  </div>;
}
