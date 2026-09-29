import {
  SCIM_ENTERPRISE_USER_SCHEMA,
  SCIM_GROUP_SCHEMA,
  SCIM_MAX_BODY_BYTES,
  SCIM_MAX_PAGE_SIZE,
  SCIM_MAX_PATCH_OPERATIONS,
  SCIM_RESOURCE_TYPE_SCHEMA,
  SCIM_SCHEMA_SCHEMA,
  SCIM_SERVICE_PROVIDER_CONFIG_SCHEMA,
  SCIM_USER_SCHEMA,
} from '@/lib/labbai/scim/protocol/constants'

/**
 * The discovery documents of RFC 7644 section 4. They describe only what this
 * server implements, so a provider negotiating against them does not attempt
 * a feature (bulk, sort, change-password) it would then see refused.
 */

export function serviceProviderConfig(baseUrl: string) {
  return {
    schemas: [SCIM_SERVICE_PROVIDER_CONFIG_SCHEMA],
    documentationUri: 'https://datatracker.ietf.org/doc/html/rfc7644',
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: SCIM_MAX_PAGE_SIZE },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      {
        type: 'oauthbearertoken',
        name: 'Bearer token',
        description: 'A bearer token issued in the organization security settings.',
        primary: true,
      },
    ],
    maxOperations: SCIM_MAX_PATCH_OPERATIONS,
    maxPayloadSize: SCIM_MAX_BODY_BYTES,
    meta: {
      resourceType: 'ServiceProviderConfig',
      location: `${baseUrl}/ServiceProviderConfig`,
    },
  }
}

export function resourceTypes(baseUrl: string) {
  return [
    {
      schemas: [SCIM_RESOURCE_TYPE_SCHEMA],
      id: 'User',
      name: 'User',
      endpoint: '/Users',
      description: 'An organization member provisioned by the identity provider',
      schema: SCIM_USER_SCHEMA,
      schemaExtensions: [{ schema: SCIM_ENTERPRISE_USER_SCHEMA, required: false }],
      meta: { resourceType: 'ResourceType', location: `${baseUrl}/ResourceTypes/User` },
    },
    {
      schemas: [SCIM_RESOURCE_TYPE_SCHEMA],
      id: 'Group',
      name: 'Group',
      endpoint: '/Groups',
      description: 'A directory group that can be mapped to workspaces and roles',
      schema: SCIM_GROUP_SCHEMA,
      schemaExtensions: [],
      meta: { resourceType: 'ResourceType', location: `${baseUrl}/ResourceTypes/Group` },
    },
  ]
}

interface ScimAttributeDefinition {
  name: string
  type: string
  multiValued: boolean
  description: string
  required: boolean
  caseExact: boolean
  mutability: string
  returned: string
  uniqueness: string
  subAttributes?: ScimAttributeDefinition[]
  referenceTypes?: string[]
}

interface AttributeOptions {
  type?: 'string' | 'boolean' | 'complex' | 'reference'
  multiValued?: boolean
  required?: boolean
  caseExact?: boolean
  mutability?: 'readOnly' | 'readWrite' | 'immutable' | 'writeOnly'
  returned?: 'always' | 'never' | 'default' | 'request'
  uniqueness?: 'none' | 'server' | 'global'
  subAttributes?: ScimAttributeDefinition[]
  referenceTypes?: string[]
}

function attribute(
  name: string,
  description: string,
  options: AttributeOptions = {}
): ScimAttributeDefinition {
  const { subAttributes, referenceTypes, ...rest } = options
  return {
    name,
    type: rest.type ?? 'string',
    multiValued: rest.multiValued ?? false,
    description,
    required: rest.required ?? false,
    caseExact: rest.caseExact ?? false,
    mutability: rest.mutability ?? 'readWrite',
    returned: rest.returned ?? 'default',
    uniqueness: rest.uniqueness ?? 'none',
    ...(subAttributes ? { subAttributes } : {}),
    ...(referenceTypes ? { referenceTypes } : {}),
  }
}

export function schemaDefinitions(baseUrl: string) {
  const schemaMeta = (id: string) => ({
    resourceType: 'Schema',
    location: `${baseUrl}/Schemas/${id}`,
  })
  return [
    {
      schemas: [SCIM_SCHEMA_SCHEMA],
      id: SCIM_USER_SCHEMA,
      name: 'User',
      description: 'User account',
      attributes: [
        attribute('userName', 'Unique identifier for the user, usually an email address', {
          required: true,
          uniqueness: 'server',
        }),
        attribute('externalId', 'Identifier assigned by the provisioning client'),
        attribute('displayName', 'Name displayed to end users'),
        attribute('name', 'The components of the user’s name', {
          type: 'complex',
          subAttributes: [
            attribute('formatted', 'Full name'),
            attribute('givenName', 'Given name'),
            attribute('familyName', 'Family name'),
          ],
        }),
        attribute('active', 'Whether the user may sign in', { type: 'boolean' }),
        attribute('emails', 'Email addresses', {
          type: 'complex',
          multiValued: true,
          subAttributes: [
            attribute('value', 'Email address'),
            attribute('type', 'Label such as work'),
            attribute('primary', 'Preferred address', { type: 'boolean' }),
          ],
        }),
        attribute('groups', 'Groups the user belongs to', {
          type: 'complex',
          multiValued: true,
          mutability: 'readOnly',
          subAttributes: [
            attribute('value', 'Group id', { mutability: 'readOnly' }),
            attribute('display', 'Group name', { mutability: 'readOnly' }),
            attribute('$ref', 'Group URI', {
              type: 'reference',
              mutability: 'readOnly',
              referenceTypes: ['Group'],
            }),
          ],
        }),
      ],
      meta: schemaMeta(SCIM_USER_SCHEMA),
    },
    {
      schemas: [SCIM_SCHEMA_SCHEMA],
      id: SCIM_GROUP_SCHEMA,
      name: 'Group',
      description: 'Group',
      attributes: [
        attribute('displayName', 'Group name', { required: true, uniqueness: 'server' }),
        attribute('externalId', 'Identifier assigned by the provisioning client'),
        attribute('members', 'Group members', {
          type: 'complex',
          multiValued: true,
          subAttributes: [
            attribute('value', 'User id', { mutability: 'immutable' }),
            attribute('display', 'User name', { mutability: 'readOnly' }),
            attribute('$ref', 'User URI', {
              type: 'reference',
              mutability: 'immutable',
              referenceTypes: ['User'],
            }),
          ],
        }),
      ],
      meta: schemaMeta(SCIM_GROUP_SCHEMA),
    },
    {
      schemas: [SCIM_SCHEMA_SCHEMA],
      id: SCIM_ENTERPRISE_USER_SCHEMA,
      name: 'EnterpriseUser',
      description: 'Enterprise user extension',
      attributes: [
        attribute('employeeNumber', 'Employee number'),
        attribute('costCenter', 'Cost center'),
        attribute('organization', 'Organization'),
        attribute('division', 'Division'),
        attribute('department', 'Department'),
        attribute('manager', 'Manager', {
          type: 'complex',
          subAttributes: [
            attribute('value', 'Manager id'),
            attribute('displayName', 'Manager name', { mutability: 'readOnly' }),
          ],
        }),
      ],
      meta: schemaMeta(SCIM_ENTERPRISE_USER_SCHEMA),
    },
  ]
}
