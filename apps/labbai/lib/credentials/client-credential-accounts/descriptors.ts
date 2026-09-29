/**
 * Client-safe descriptors for client-credentials service-account providers.
 *
 * A client-credential account is a `service_account`-type credential where a
 * workspace admin supplies an OAuth client identity plus a shared secret or
 * signing key and provider account identifier. Unlike the token-paste family
 * (whose stored secret IS the access token), these credentials mint a
 * short-lived access token on demand. This module holds only UI/contract
 * metadata (field lists, labels, docs links); the server-side minting registry
 * lives in `@/lib/credentials/client-credential-accounts/server`.
 */

/** Discriminator stored inside every encrypted client-credential secret blob. */
export const CLIENT_CREDENTIAL_ACCOUNT_SECRET_TYPE = 'client_credential_account' as const

/** Contract field ids a client-credential connect modal collects. */
export type ClientCredentialAccountFieldId =
  | 'clientId'
  | 'clientSecret'
  | 'certificateId'
  | 'orgId'
  | 'dataCenter'
  | 'authMethod'
  | 'privateKey'
  | 'username'

/**
 * The field id that selects between a descriptor's auth methods. A descriptor
 * declaring it must also set `defaultAuthMethod`, or every branch-specific
 * field resolves to hidden.
 */
export const AUTH_METHOD_FIELD_ID = 'authMethod' as const satisfies ClientCredentialAccountFieldId

export interface ClientCredentialAccountOption {
  value: string
  label: string
}

export interface ClientCredentialAccountField {
  id: ClientCredentialAccountFieldId
  label: string
  placeholder: string
  /** Rendered with SecretInput and never echoed back. */
  secret: boolean
  /**
   * Renders a multi-line control instead of a single-line one. Required for
   * PEM-encoded material (a private key spans ~28 newline-separated lines and
   * is unreadable — and unverifiable by eye — in a single-line input). A
   * `secret` field that is also `multiline` renders as a plain textarea rather
   * than a masked input; the modal never prefills a secret, so masking would
   * only hide the user's own paste from them.
   */
  multiline?: boolean
  /**
   * Auth methods this field belongs to, for descriptors offering more than one
   * (Salesforce: client credentials vs JWT bearer). The field is hidden, and
   * skipped by validation, unless the selected method appears in this list.
   * Absent means the field belongs to every branch.
   */
  requiredForAuthMethods?: readonly string[]
  /**
   * Field the connect modal may submit empty; excluded from
   * {@link CLIENT_CREDENTIAL_ACCOUNT_REQUIRED_FIELDS} so create/reconnect
   * validation never demands it. Omitted (default) means required.
   */
  optional?: boolean
  /**
   * Fixed value set, rendered by the connect modal as a dropdown — which removes
   * the need for a format hint on the field. Required on `dataCenter`: the modal
   * renders that field only when it carries options, so a region selector added
   * without them would silently not appear.
   */
  options?: ReadonlyArray<ClientCredentialAccountOption>
  /** Always-visible guidance, for a field whose value is not self-explanatory. */
  hint?: string
  /** Soft-format hint shown while the current value doesn't match `hintPattern`. */
  hintPattern?: RegExp
  hintMessage?: string
  /**
   * Normalizes the raw value before testing `hintPattern`, mirroring the
   * server-side normalization so values the server accepts (e.g. a pasted
   * `https://` URL) don't show a false format hint.
   */
  hintNormalize?: (value: string) => string
}

export interface ClientCredentialAccountDescriptor {
  /** Stable credential `providerId` (`<provider>-service-account`). */
  providerId: string
  /** Human service label used in modal copy and error messages (e.g. "Zoom"). */
  serviceLabel: string
  /**
   * Short vendor-accurate noun for connect-surface labels ("Add {connectNoun}").
   * Uses the vendor's own vocabulary for the credential.
   */
  connectNoun: string
  fields: ClientCredentialAccountField[]
  /**
   * Grant used when no `authMethod` is submitted or stored. Required on any
   * descriptor carrying an `authMethod` field; meaningless without one.
   */
  defaultAuthMethod?: string
  /** Optional setup guide, docked bottom-left of the connect modal. */
  docsUrl?: string
  /** Optional one-line caveat rendered in the connect modal. */
  helpText?: string
}

export const ZOOM_SERVICE_ACCOUNT_PROVIDER_ID = 'zoom-service-account' as const

export type ClientCredentialAccountProviderId = typeof ZOOM_SERVICE_ACCOUNT_PROVIDER_ID

export const CLIENT_CREDENTIAL_ACCOUNT_DESCRIPTORS: Record<
  ClientCredentialAccountProviderId,
  ClientCredentialAccountDescriptor
> = {
  [ZOOM_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: ZOOM_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Zoom',
    connectNoun: 'server-to-server app',
    fields: [
      {
        id: 'clientId',
        label: 'Client ID',
        placeholder: 'Paste the client ID',
        secret: false,
      },
      {
        id: 'clientSecret',
        label: 'Client secret',
        placeholder: 'Paste the client secret',
        secret: true,
      },
      {
        id: 'orgId',
        label: 'Account ID',
        placeholder: 'Paste the account ID',
        secret: false,
      },
    ],
    helpText:
      'The Account ID on the App Credentials page is not the account number shown in the Zoom web portal. The app must be activated before tokens can be issued.',
  },
}

/**
 * Required contract fields per client-credential provider, consumed by the
 * `createCredentialBodySchema` superRefine so validation errors name the exact
 * missing field. Derived from each descriptor's field list, minus the fields
 * marked `optional`.
 */
export const CLIENT_CREDENTIAL_ACCOUNT_REQUIRED_FIELDS: Record<
  string,
  ClientCredentialAccountFieldId[]
> = Object.fromEntries(
  Object.values(CLIENT_CREDENTIAL_ACCOUNT_DESCRIPTORS).map((descriptor) => [
    descriptor.providerId,
    descriptor.fields.filter((field) => !field.optional).map((field) => field.id),
  ])
)

/**
 * Resolves a submitted or stored `authMethod` to one the descriptor actually
 * offers, falling back to its `defaultAuthMethod`. Returns `undefined` for
 * single-grant providers, whose fields are never method-conditional.
 *
 * Resolving (rather than reading the raw value) is what makes credentials
 * created before the field existed keep working: their blob carries no
 * `authMethod`, and the default is the grant they were created with.
 */
export function resolveClientCredentialAuthMethod(
  descriptor: ClientCredentialAccountDescriptor,
  authMethod: string | undefined
): string | undefined {
  const options = descriptor.fields.find((field) => field.id === AUTH_METHOD_FIELD_ID)?.options
  if (!options) return undefined
  const trimmed = authMethod?.trim()
  return options.some((option) => option.value === trimmed) ? trimmed : descriptor.defaultAuthMethod
}

/**
 * Splits a descriptor's fields for one auth method: `visible` is what the
 * connect modal renders, `required` is what must be non-empty to submit.
 *
 * A field with no `requiredForAuthMethods` belongs to every branch and is
 * required unless marked `optional`; a branch-specific field is both hidden
 * and skipped by validation on the other branches. Resolves the method once,
 * so callers never re-resolve per field.
 *
 * The static {@link CLIENT_CREDENTIAL_ACCOUNT_REQUIRED_FIELDS} map above
 * cannot express this — it feeds a contract schema that validates one shape
 * per provider — so the branch-specific requirement is enforced by the
 * server-side secret builder and mirrored by the connect modal's submit gate.
 */
export function partitionClientCredentialFields(
  descriptor: ClientCredentialAccountDescriptor,
  authMethod: string | undefined
): { visible: ClientCredentialAccountField[]; required: ClientCredentialAccountField[] } {
  const resolved = resolveClientCredentialAuthMethod(descriptor, authMethod)
  const visible: ClientCredentialAccountField[] = []
  const required: ClientCredentialAccountField[] = []
  for (const field of descriptor.fields) {
    if (field.requiredForAuthMethods) {
      if (resolved === undefined || !field.requiredForAuthMethods.includes(resolved)) continue
      visible.push(field)
      required.push(field)
      continue
    }
    visible.push(field)
    if (!field.optional) required.push(field)
  }
  return { visible, required }
}

export function isClientCredentialAccountProviderId(
  value: string | null | undefined
): value is ClientCredentialAccountProviderId {
  return Boolean(value && Object.hasOwn(CLIENT_CREDENTIAL_ACCOUNT_DESCRIPTORS, value))
}

export function getClientCredentialAccountDescriptor(
  providerId: string | null | undefined
): ClientCredentialAccountDescriptor | undefined {
  return isClientCredentialAccountProviderId(providerId)
    ? CLIENT_CREDENTIAL_ACCOUNT_DESCRIPTORS[providerId]
    : undefined
}
