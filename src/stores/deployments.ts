import { defineStore } from "pinia";
import { api } from "../api";
import type { DeploymentView, MigrationReport, TunnelStatus } from "../types";

/**
 * 远程部署域状态（ADR-0003）：部署注册表 CRUD 视图、别名候选（~/.ssh/config）、
 * 常驻隧道状态（键 = 部署 id）、pk 通道开通、存量迁移与悬空绑定呈现。
 */
export const useDeploymentsStore = defineStore("deployments", {
  state: () => ({
    list: [] as DeploymentView[],
    /** ~/.ssh/config Host 条目（别名下拉候选；编辑中的别名即使已不在 config 也保留可选） */
    aliasOptions: [] as string[],
    /** 常驻隧道状态（部署 id → tunnel_status） */
    tunnelStates: {} as Record<string, TunnelStatus>,
    /** 悬空绑定（agent 绑定的别名不在注册表——设置页呈现） */
    dangling: [] as Array<{ agentId: string; agentName: string; alias: string }>,
  }),
  getters: {
    /** agent 绑定下拉的选项集：已有部署别名（注册表为准）∪ config 候选 */
    bindingOptions(state): string[] {
      const inReg = state.list.map((d) => d.alias);
      return Array.from(new Set([...inReg, ...state.aliasOptions])).sort();
    },
  },
  actions: {
    async load() {
      this.list = await api.deploymentList().catch(() => []);
      this.aliasOptions = await api.sshAliasOptions().catch(() => []);
      this.dangling = await api.danglingDeploymentRefs().catch(() => []);
      this.loadTunnelStatuses();
    },
    /** 刷新开了常驻开关的部署隧道状态（进入设置页 / 保存 / 开通后调用） */
    loadTunnelStatuses(sink?: Record<string, TunnelStatus>) {
      const targets = this.list.filter((d) => d.pkTunnel?.persistent);
      if (sink) {
        // 兼容期：旧 agents store 的 tunnelStates 引用同步清空（键域已换）
        for (const k of Object.keys(sink)) delete sink[k];
      }
      for (const d of targets) {
        api
          .tunnelStatus(d.id)
          .then((s) => {
            this.tunnelStates[d.id] = s;
          })
          .catch(() => {
            delete this.tunnelStates[d.id];
          });
      }
    },
    refreshTunnel(id: string) {
      if (!id) return;
      api
        .tunnelStatus(id)
        .then((s) => {
          this.tunnelStates[id] = s;
        })
        .catch(() => {
          delete this.tunnelStates[id];
        });
    },
    /** 部署新建/编辑（后端校验路径不变式/别名唯一/级联确认） */
    async upsert(input: Parameters<typeof api.deploymentUpsert>[0]): Promise<DeploymentView> {
      const view = await api.deploymentUpsert(input);
      await api.syncTunnels().catch(() => {});
      await this.load();
      return view;
    },
    async remove(id: string) {
      await api.deploymentDelete(id);
      await api.syncTunnels().catch(() => {});
      await this.load();
    },
    /** pk 通道开通（部署驱动）：成功后同步隧道集合并刷新状态 */
    async setupPk(id: string, port?: number) {
      const report = await api.setupDeploymentPk(id, port);
      if (report.ok) {
        await api.syncTunnels().catch(() => {});
        await this.load();
        this.refreshTunnel(id);
      }
      return report;
    },
    /** 存量迁移（幂等）：完成后重载部署与 agent 列表 */
    async migrate(): Promise<MigrationReport> {
      const report = await api.migrateAgentRemote();
      await this.load();
      return report;
    },
  },
});
