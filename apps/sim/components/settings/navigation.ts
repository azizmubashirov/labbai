import type { ComponentType } from 'react'
import {
  ClipboardList,
  GridOffset,
  Key,
  ListChecks,
  Lock,
  Server,
  Settings,
  ShieldCheck,
  TerminalWindow,
  Trash,
  Users,
  Wrench,
} from '@sim/emcn/icons'
import { type PermissionType, permissionSatisfies } from '@sim/platform-authz/workspace'
import { McpIcon } from '@/components/icons'
import type { SettingsHeaderMeta } from '@/components/settings/settings-header'
import type { DeploymentFeatures, DeploymentShape } from '@/lib/api/contracts/workspaces'

export type SettingsPlane = 'account' | 'workspace'

export type AccountSettingsSection = 'general' | 'api-keys' | 'admin'

export type OrganizationSettingsSection =
  | 'connected-accounts'
  | 'members'
  | 'access-control'
  | 'requests'
  | 'audit-logs'
  | 'security'

export type WorkspaceSettingsSection =
  | 'requests'
  | 'teammates'
  | 'secrets'
  | 'custom-tools'
  | 'mcp'
  | 'workflow-mcp-servers'
  | 'api-keys'
  | 'recently-deleted'

export type SettingsSection =
  | AccountSettingsSection
  | OrganizationSettingsSection
  | WorkspaceSettingsSection

export interface SettingsNavigationItem<Section extends string = string> {
  id: Section
  label: string
  description: string
  icon: ComponentType<{ className?: string }>
  group: string
  docsLink?: string
}

export type UnifiedSettingsSection =
  | 'connected-accounts'
  | 'general'
  | 'secrets'
  | 'access-control'
  | 'requests'
  | 'audit-logs'
  | 'apikeys'
  | 'teammates'
  | 'organization'
  | 'mcp'
  | 'custom-tools'
  | 'workflow-mcp-servers'
  | 'admin'
  | 'security'
  | 'recently-deleted'

export type UnifiedNavigationSection = 'account' | 'workspace' | 'organization' | 'platform'

export interface UnifiedSettingsNavigationItem {
  id: UnifiedSettingsSection
  label: string
  description: string
  icon: ComponentType<{ className?: string }>
  section: UnifiedNavigationSection
  order: number
  requiresEnterprise?: boolean
  requiresMax?: boolean
  requiresHosted?: boolean
  /**
   * The inverse of {@link UnifiedSettingsNavigationItem.requiresHosted}: the
   * section exists only on a self-hosted deployment and is absent on Sim Cloud,
   * where the same surface is reached from the managed service instead.
   */
  requiresSelfHosted?: boolean
  /** See {@link SelfHostedOverride}; resolved against the deployment shape at filter time. */
  selfHostedOverride?: SelfHostedOverride
  requiresSuperUser?: boolean
  requiresAdminRole?: boolean
  allowNonOrgAdmin?: boolean
  showWhenLocked?: boolean
  hideForEnterprise?: boolean
  externalUrl?: string
  docsLink?: string
  /**
   * The organization-scoped counterpart of this section. Declaring it marks the
   * section without a workspace projection as acting on the host organization, which
   * routes it through the organization gate (host organization present, org-admin
   * viewer, plan entitlement) in both the sidebar and the section page.
   *
   * This is the single source for {@link ORGANIZATION_PLANE_UNIFIED_SECTIONS} and
   * {@link UNIFIED_TO_ORGANIZATION_SECTION}, so the two cannot drift apart.
   */
  organizationSection?: OrganizationSettingsSection
}

interface UnifiedSettingsProjection
  extends Omit<UnifiedSettingsNavigationItem, 'label' | 'icon' | 'section' | 'docsLink'> {
  group: UnifiedNavigationSection
}

interface SettingsPlaneSectionMap {
  account: AccountSettingsSection
  workspace: WorkspaceSettingsSection
}

interface SettingsPlaneProjection<Section extends string> {
  id: Section
  group: string
  order: number
  /** Plane-specific label, only when the surface's scope genuinely differs. */
  label?: string
  /** Plane-specific description, only when the surface's scope genuinely differs. */
  description?: string
}

type SettingsPlaneProjections = {
  readonly [Plane in SettingsPlane]?: SettingsPlaneProjection<SettingsPlaneSectionMap[Plane]>
}

export interface SettingsSectionRegistryEntry {
  label: string
  icon: ComponentType<{ className?: string }>
  docsLink?: string
  /** Omit for sections that exist only on a standalone plane. */
  unified?: UnifiedSettingsProjection
  planes?: SettingsPlaneProjections
}

/**
 * How a section unlocks on a self-hosted deployment: `'always'` unconditionally, or
 * when the named enterprise feature resolves on for the deployment. Named rather than
 * read here so the catalog stays a constant and the sidebar and the server gate resolve
 * the same server-provided shape — see {@link isSelfHostedOverrideEnabled}. That is what
 * keeps nav and server agreeing: a section is visible exactly when its API would accept
 * the request.
 */
export type SelfHostedOverride = 'always' | keyof DeploymentFeatures

/**
 * Whether a section's self-hosted override unlocks it on this deployment. Always false
 * on Sim Cloud, where subscription plans decide entitlement instead.
 */
export function isSelfHostedOverrideEnabled(
  override: SelfHostedOverride | undefined,
  deployment: DeploymentShape
): boolean {
  if (override === undefined || deployment.hosted) return false
  return override === 'always' || deployment.features[override]
}

type SettingsHrefSearchParams = Pick<URLSearchParams, 'toString'>

function withSettingsSearchParams(
  pathname: string,
  searchParams?: SettingsHrefSearchParams
): string {
  const query = searchParams?.toString()
  return query ? `${pathname}?${query}` : pathname
}

export function getAccountSettingsHref(
  section: AccountSettingsSection,
  searchParams?: SettingsHrefSearchParams
): string {
  return withSettingsSearchParams(`/account/settings/${section}`, searchParams)
}

export function getWorkspaceSettingsHref(
  workspaceId: string,
  section: WorkspaceSettingsSection,
  searchParams?: SettingsHrefSearchParams
): string {
  return withSettingsSearchParams(`/workspace/${workspaceId}/settings/${section}`, searchParams)
}

export const ACCOUNT_SETTINGS_PATH_ALIASES = {
  apikeys: 'api-keys',
} as const satisfies Readonly<Record<string, AccountSettingsSection>>

export const WORKSPACE_SETTINGS_PATH_ALIASES = {
  apikeys: 'api-keys',
} as const satisfies Readonly<Record<string, WorkspaceSettingsSection>>

interface ParseSettingsPathSectionOptions<
  Section extends string,
  DefaultSection extends Section | null,
> {
  path: string | null | undefined
  items: readonly SettingsNavigationItem<Section>[]
  defaultSection: DefaultSection
  aliases?: Readonly<Partial<Record<string, Section>>>
}

/**
 * Resolves the first segment after `settings`, or a route-provided section
 * segment, against a typed settings catalog.
 */
export function parseSettingsPathSection<
  Section extends string,
  const DefaultSection extends Section | null,
>({
  path,
  items,
  defaultSection,
  aliases,
}: ParseSettingsPathSectionOptions<Section, DefaultSection>): Section | DefaultSection {
  if (!path) return defaultSection

  const pathname = path.split(/[?#]/, 1)[0]
  const segments = pathname.split('/').filter(Boolean)
  const settingsIndex = segments.lastIndexOf('settings')
  let pathSection: string | undefined
  if (settingsIndex === -1) {
    pathSection = segments.length === 1 ? segments[0] : undefined
  } else {
    pathSection = segments[settingsIndex + 1]
  }
  if (!pathSection) return defaultSection

  const normalized = aliases?.[pathSection] ?? pathSection
  return items.find((item) => item.id === normalized)?.id ?? defaultSection
}

export const ACCOUNT_SETTINGS_GROUPS = [
  { key: 'account', title: 'Account' },
  { key: 'developer', title: 'Developer' },
  { key: 'platform', title: 'Platform' },
] as const

/** Planes with their own standalone shell; the workspace plane renders inside the editor. */
export type StandaloneSettingsPlane = Exclude<SettingsPlane, 'workspace'>

/** Per-plane sidebar chrome. */
export const SETTINGS_PLANE_CHROME: Record<
  StandaloneSettingsPlane,
  { label: string; showWordmark: boolean }
> = {
  account: { label: 'Account', showWordmark: false },
}

export const SETTINGS_SECTION_REGISTRY: readonly SettingsSectionRegistryEntry[] = [
  {
    label: 'General',
    icon: Settings,
    unified: {
      id: 'general',
      description: 'Manage your profile, appearance, and preferences.',
      group: 'account',
      order: 0,
    },
    planes: {
      account: { id: 'general', group: 'account', order: 0 },
    },
  },
  {
    label: 'Requests',
    icon: ListChecks,
    unified: {
      id: 'requests',
      description: 'Track your requests and browse available access.',
      group: 'workspace',
      order: 12,
      organizationSection: 'requests',
    },
    planes: {
      workspace: { id: 'requests', group: 'workspace', order: 12 },
    },
  },
  {
    label: 'Permission groups',
    icon: ShieldCheck,
    unified: {
      id: 'access-control',
      description: 'Manage permission groups across your organization.',
      group: 'organization',
      order: 4,
      organizationSection: 'access-control',
    },
  },
  {
    label: 'Audit logs',
    icon: ClipboardList,
    unified: {
      id: 'audit-logs',
      description: 'Review activity and changes across your organization.',
      group: 'organization',
      order: 5,
      organizationSection: 'audit-logs',
    },
  },
  {
    label: 'Teammates',
    icon: Users,
    unified: {
      id: 'teammates',
      description: 'Manage your teammates in this workspace.',
      group: 'workspace',
      order: 0,
    },
    planes: {
      workspace: { id: 'teammates', group: 'workspace', order: 0 },
    },
  },
  {
    label: 'Members',
    icon: Users,
    unified: {
      id: 'organization',
      description: 'Members and workspace access in your organization.',
      group: 'organization',
      order: 0,
      organizationSection: 'members',
    },
  },
  {
    label: 'Secrets',
    icon: Key,
    unified: {
      id: 'secrets',
      description: 'Store environment variables for your workflows.',
      group: 'workspace',
      order: 1,
    },
    planes: {
      workspace: { id: 'secrets', group: 'workspace', order: 1 },
    },
  },
  {
    label: 'Credential groups',
    icon: GridOffset,
    unified: {
      id: 'connected-accounts',
      description: 'Manage integrations and workspace access for workflows and Chat.',
      group: 'organization',
      order: 1,
      organizationSection: 'connected-accounts',
    },
  },
  {
    label: 'Custom tools',
    icon: Wrench,
    unified: {
      id: 'custom-tools',
      description: 'Create and manage custom tools for your agents.',
      group: 'workspace',
      order: 3,
    },
    planes: {
      workspace: { id: 'custom-tools', group: 'tools', order: 4 },
    },
  },
  {
    label: 'MCP tools',
    icon: McpIcon,
    unified: {
      id: 'mcp',
      description: 'Connect external MCP servers and use their tools in this workspace.',
      group: 'workspace',
      order: 2,
    },
    planes: {
      workspace: { id: 'mcp', group: 'tools', order: 5 },
    },
  },
  {
    label: 'Labbai API keys',
    icon: TerminalWindow,
    unified: {
      id: 'apikeys',
      description: 'Create and manage API keys for the Labbai API.',
      group: 'workspace',
      order: 7,
    },
    planes: {
      account: {
        id: 'api-keys',
        description: 'Create and manage your personal Labbai API keys.',
        group: 'developer',
        order: 2,
      },
      workspace: {
        id: 'api-keys',
        description: 'Manage workspace API keys and personal-key policy.',
        group: 'system',
        order: 7,
      },
    },
  },
  {
    label: 'MCP servers',
    icon: Server,
    unified: {
      id: 'workflow-mcp-servers',
      description: 'Expose workflows from this workspace as tools on an MCP server.',
      group: 'workspace',
      order: 6,
    },
    planes: {
      workspace: { id: 'workflow-mcp-servers', group: 'tools', order: 6 },
    },
  },
  {
    label: 'Recently deleted',
    icon: Trash,
    unified: {
      id: 'recently-deleted',
      description: 'Restore items deleted in the last 30 days.',
      group: 'workspace',
      order: 10,
    },
    planes: {
      workspace: { id: 'recently-deleted', group: 'system', order: 9 },
    },
  },
  {
    label: 'Security',
    icon: Lock,
    unified: {
      id: 'security',
      description: 'Manage SCIM provisioning and view outbound IP addresses.',
      group: 'organization',
      order: 8,
      organizationSection: 'security',
    },
  },
  {
    label: 'Admin',
    icon: Lock,
    unified: {
      id: 'admin',
      description: 'Superuser administration and workspace tools.',
      group: 'platform',
      order: 0,
      requiresAdminRole: true,
    },
    planes: {
      account: { id: 'admin', group: 'platform', order: 4 },
    },
  },
]

/**
 * Every unified section this build can render, including ones the current deployment
 * does not offer. Deployment filtering (`requiresHosted`, `requiresSelfHosted`)
 * belongs to the sidebar and the section gate, which read the server-resolved shape.
 * Keeping an unavailable section in the catalog is what lets the route treat it as a
 * known segment and redirect to General rather than answer 404.
 */
export function buildUnifiedSettingsCatalog(): UnifiedSettingsNavigationItem[] {
  return SETTINGS_SECTION_REGISTRY.flatMap(({ label, icon, docsLink, unified }) => {
    if (!unified) return []
    const { group, ...item } = unified
    return [
      {
        ...item,
        label,
        icon,
        section: group,
        ...(docsLink ? { docsLink } : {}),
      },
    ]
  })
}

function buildPlaneSettingsItems<Plane extends SettingsPlane>(
  plane: Plane
): SettingsNavigationItem<SettingsPlaneSectionMap[Plane]>[] {
  return SETTINGS_SECTION_REGISTRY.flatMap((entry) => {
    const projection = entry.planes?.[plane]
    return projection ? [{ entry, projection }] : []
  })
    .sort((left, right) => left.projection.order - right.projection.order)
    .map(({ entry, projection }) => {
      // A plane-only section carries no unified projection to inherit from, so
      // its own description is the only source — missing one is a registry bug.
      const description = projection.description ?? entry.unified?.description
      if (!description) {
        throw new Error(`Settings section "${projection.id}" is missing a description`)
      }
      return {
        id: projection.id,
        label: projection.label ?? entry.label,
        description,
        icon: entry.icon,
        group: projection.group,
        ...(entry.docsLink ? { docsLink: entry.docsLink } : {}),
      }
    })
}

export const ACCOUNT_SETTINGS_ITEMS: SettingsNavigationItem<AccountSettingsSection>[] =
  buildPlaneSettingsItems('account')

export const WORKSPACE_SETTINGS_ITEMS: SettingsNavigationItem<WorkspaceSettingsSection>[] =
  buildPlaneSettingsItems('workspace')

/**
 * Unified sections that resolve to organization-plane settings. The workspace
 * settings section page routes these through the organization gate (host
 * organization present + org-admin viewer), so workspace-plane navigation must
 * apply the same requirement before surfacing them.
 */
export const ORGANIZATION_PLANE_UNIFIED_SECTIONS: ReadonlySet<UnifiedSettingsSection> = new Set(
  SETTINGS_SECTION_REGISTRY.flatMap((entry) =>
    entry.unified?.organizationSection && !entry.planes?.workspace ? [entry.unified.id] : []
  )
)

/**
 * Unified section id to the organization-scoped section it acts on, for the gates
 * that take an {@link OrganizationSettingsSection} (`canOpenOrganizationSettingsSection`,
 * `isOrganizationSettingsSectionAvailable`).
 *
 * Derived from the registry rather than hand-listed: a section added to one and
 * forgotten in the other used to mean the page applied *no* organization gate at
 * all, since an unmapped section reads as "not organization-scoped".
 */
export const UNIFIED_TO_ORGANIZATION_SECTION: Readonly<
  Partial<Record<UnifiedSettingsSection, OrganizationSettingsSection>>
> = Object.fromEntries(
  SETTINGS_SECTION_REGISTRY.flatMap((entry) =>
    entry.unified?.organizationSection && !entry.planes?.workspace
      ? [[entry.unified.id, entry.unified.organizationSection] as const]
      : []
  )
)

export const UNIFIED_TO_WORKSPACE_SECTION: Readonly<
  Partial<Record<UnifiedSettingsSection, WorkspaceSettingsSection>>
> = Object.fromEntries(
  SETTINGS_SECTION_REGISTRY.flatMap((entry) => {
    const unifiedSection = entry.unified?.id
    const workspaceSection = entry.planes?.workspace?.id
    return unifiedSection && workspaceSection ? [[unifiedSection, workspaceSection] as const] : []
  })
)

export type OrganizationSectionAccess = 'unavailable' | 'view' | 'manage'

interface ResolveOrganizationSectionAccessOptions {
  section: OrganizationSettingsSection
  isTargetOrganizationMember: boolean
  isTargetOrganizationAdmin: boolean
}

export function resolveOrganizationSectionAccess({
  section,
  isTargetOrganizationMember,
  isTargetOrganizationAdmin,
}: ResolveOrganizationSectionAccessOptions): OrganizationSectionAccess {
  if (!isTargetOrganizationMember) return 'unavailable'
  if (section === 'members' || section === 'requests')
    return isTargetOrganizationAdmin ? 'manage' : 'view'
  return isTargetOrganizationAdmin ? 'manage' : 'unavailable'
}

export interface OrganizationSettingsFeatures {
  hasEnterprisePlan: boolean
  /**
   * Whether the organization's permission-group regime is in force, which outlives the plan gate
   * through a failing payment — see `isOrganizationGovernanceActive`. Only Access Control reads
   * it, because only that section edits something that keeps applying while the gate is closed.
   */
  governanceActive: boolean
  hosted: boolean
  selfHosted: Partial<Record<OrganizationSettingsSection, boolean>>
}

export function getOrganizationSettingsFeatures(
  hasEnterprisePlan: boolean,
  deployment: DeploymentShape,
  /** Defaults to the plan gate, so a caller with no reason to distinguish the two keeps its behavior. */
  governanceActive: boolean = hasEnterprisePlan
): OrganizationSettingsFeatures {
  const { features } = deployment
  return {
    hasEnterprisePlan,
    governanceActive,
    hosted: deployment.hosted,
    selfHosted: {
      'connected-accounts': true,
      'access-control': features.accessControl,
      'audit-logs': features.auditLogs,
      security: true,
    },
  }
}

/**
 * Applies deployment and target-organization plan gates without consulting the
 * viewer's active organization.
 */
export function isOrganizationSettingsSectionAvailable(
  section: OrganizationSettingsSection,
  features: OrganizationSettingsFeatures
): boolean {
  if (section === 'members' || section === 'requests') return true
  /**
   * Access Control follows governance rather than the plan gate: its restrictions keep applying
   * through a failing payment, so hiding the page that edits them would leave an organization
   * governed by rules it cannot see or loosen until the invoice clears.
   */
  if (section === 'access-control' && features.hosted) return features.governanceActive
  if (features.hosted) return features.hasEnterprisePlan
  return features.selfHosted[section] ?? false
}

export interface WorkspacePermissionConfig {
  hideSecretsTab?: boolean
  hideApiKeysTab?: boolean
  disableMcpTools?: boolean
  disableCustomTools?: boolean
}

export const WORKSPACE_PERMISSION_CONFIG_KEYS: Partial<
  Record<WorkspaceSettingsSection, keyof WorkspacePermissionConfig>
> = {
  secrets: 'hideSecretsTab',
  'api-keys': 'hideApiKeysTab',
  mcp: 'disableMcpTools',
  'custom-tools': 'disableCustomTools',
}

export function workspaceSectionUsesPermissionConfig(section: WorkspaceSettingsSection): boolean {
  return WORKSPACE_PERMISSION_CONFIG_KEYS[section] !== undefined
}

export function getSettingsPermissionConfigKey(section: UnifiedSettingsSection) {
  const workspaceSection = UNIFIED_TO_WORKSPACE_SECTION[section]
  return workspaceSection ? WORKSPACE_PERMISSION_CONFIG_KEYS[workspaceSection] : undefined
}

interface ResolveWorkspaceNavigationOptions {
  permission: PermissionType
  permissionConfig: WorkspacePermissionConfig
  /** Resolves the catalog's deployment gates the same way the sidebar does. */
  deployment: DeploymentShape
}

/**
 * Unified projection of each workspace-plane section, so the route gate reads the
 * deployment requirements (`requiresHosted`, `requiresSelfHosted`, `selfHostedOverride`)
 * from the same catalog entry the sidebar filters on. Nav and server then agree: a
 * section is reachable exactly when it is listed.
 */
const WORKSPACE_UNIFIED_PROJECTIONS: Readonly<
  Partial<Record<WorkspaceSettingsSection, UnifiedSettingsProjection>>
> = Object.fromEntries(
  SETTINGS_SECTION_REGISTRY.flatMap((entry) => {
    const workspaceSection = entry.planes?.workspace?.id
    return workspaceSection && entry.unified ? [[workspaceSection, entry.unified] as const] : []
  })
)

/**
 * Whether the deployment itself offers a workspace section, before viewer permission
 * and plan entitlement are considered. Mirrors the sidebar's deployment pass.
 */
function isWorkspaceSectionOfferedByDeployment(
  section: WorkspaceSettingsSection,
  deployment: DeploymentShape
): boolean {
  const unified = WORKSPACE_UNIFIED_PROJECTIONS[section]
  if (!unified) return true
  if (unified.requiresSelfHosted && deployment.hosted) return false
  if (unified.requiresHosted && !deployment.hosted) {
    return isSelfHostedOverrideEnabled(unified.selfHostedOverride, deployment)
  }
  return true
}

export interface ResolvedWorkspaceNavigationItem
  extends SettingsNavigationItem<WorkspaceSettingsSection> {
  canMutate: boolean
  locked: boolean
}

const WORKSPACE_MUTATION_PERMISSION: Record<WorkspaceSettingsSection, PermissionType> = {
  requests: 'read',
  teammates: 'admin',
  secrets: 'write',
  'custom-tools': 'write',
  mcp: 'write',
  'workflow-mcp-servers': 'write',
  'api-keys': 'admin',
  'recently-deleted': 'write',
}

export interface WorkspaceMutationCapabilities {
  canAdmin: boolean
  canEdit: boolean
}

export function canMutateWorkspaceSettingsSection(
  section: WorkspaceSettingsSection,
  capabilities: WorkspaceMutationCapabilities
): boolean {
  const permission = WORKSPACE_MUTATION_PERMISSION[section]
  if (permission === 'read') return true
  return permission === 'admin' ? capabilities.canAdmin : capabilities.canEdit
}

export function resolveWorkspaceNavigation({
  permission,
  permissionConfig,
  deployment,
}: ResolveWorkspaceNavigationOptions): ResolvedWorkspaceNavigationItem[] {
  return WORKSPACE_SETTINGS_ITEMS.flatMap((item) => {
    if (!isWorkspaceSectionOfferedByDeployment(item.id, deployment)) return []
    const permissionConfigKey = WORKSPACE_PERMISSION_CONFIG_KEYS[item.id]
    if (permissionConfigKey && permissionConfig[permissionConfigKey]) return []
    const locked = false
    const canMutate = canMutateWorkspaceSettingsSection(item.id, {
      canEdit: permissionSatisfies(permission, 'write'),
      canAdmin: permissionSatisfies(permission, 'admin'),
    })

    return [{ ...item, canMutate, locked }]
  })
}

/**
 * Adapts a navigation entry to the header shell's static identity.
 *
 * The catalog calls it `label` because it names a sidebar row; the shell calls it `title`
 * because it renders a heading. One adapter keeps every plane's shell fed from the catalog
 * instead of each one restating the mapping.
 */
export function toSettingsHeaderMeta(
  item: Pick<SettingsNavigationItem, 'label' | 'description' | 'docsLink'>
): SettingsHeaderMeta {
  return { title: item.label, description: item.description, docsLink: item.docsLink }
}

export function getSettingsSectionMeta(
  plane: SettingsPlane,
  section: string
): Pick<SettingsNavigationItem, 'label' | 'description' | 'docsLink'> | null {
  const catalog = plane === 'account' ? ACCOUNT_SETTINGS_ITEMS : WORKSPACE_SETTINGS_ITEMS
  const item = catalog.find((candidate) => candidate.id === section)
  return item ? { label: item.label, description: item.description, docsLink: item.docsLink } : null
}
