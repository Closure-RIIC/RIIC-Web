/** Filing badge asset copied from the public footer at https://www.skland.com/index. */
export function FilingLinks() {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1" data-filing-links>
      <a className="inline-flex min-h-11 items-center whitespace-nowrap underline underline-offset-4 hover:text-foreground" href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer" data-ui-number-font>沪ICP备2026041492号</a>
      <a className="inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap underline underline-offset-4 hover:text-foreground" href="https://www.beian.gov.cn/portal/registerSystemInfo?recordcode=31011502407364" target="_blank" rel="noopener noreferrer" data-ui-number-font>
        <img src="/images/partners/public-security-filing.png" alt="" width={20} height={23} className="h-auto w-3.5 shrink-0" decoding="async" />
        <span>沪公网安备31011502407364号</span>
      </a>
    </div>
  );
}
