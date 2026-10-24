# 公开仓库迁移说明

本仓库以经过审计的产品文件树创建了新的公开根提交，不包含旧私有仓库的 commit、branch、tag、邮箱或脱离 fork 关系。公开仓库从现在起是产品代码与社区协作的唯一主仓；旧私有仓库仅保留内部部署资产、隐藏测试和历史档案。

## 现有贡献者

旧私有仓库中的开放 PR 不会复制 commit。请按以下方式重新提交：

1. 删除或归档旧仓库的脱离 fork；
2. 重新 fork `Closure-RIIC/RIIC-Web`；
3. 从公开仓库最新 `develop` 创建新分支；
4. 只移植仍需要的代码，不复制旧 merge commit；
5. 向 `develop` 创建新 PR，并在描述中注明原 PR 编号。

可在旧 PR 中使用下面的通知：

> 项目已迁移到无旧历史的公开仓库。为避免公开旧私有提交和邮箱，请基于新仓库的 `develop` 重新 fork 并提交 PR；新 PR 中可以引用此 PR 编号以保留讨论上下文。

## 新协作流程

- 外部和普通功能 PR 统一进入 `develop`。
- `develop` 合并后的运行时改动进入 development 发布通道。
- `main` 只接受维护者从同仓库 `release/**` 发起的发布 PR。
- production 发布由受保护的 GitHub Environment 进行人工审批。

安全问题请按 [SECURITY.md](./SECURITY.md) 私密报告。
