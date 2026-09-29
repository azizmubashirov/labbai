import {
  documentedSchema,
  RESOURCE_CONFLICT_ERRORS,
  WORKSPACE_API_KEY_DENIED,
} from '@/lib/api/contracts/v2/openapi/shared'
import { v2GetSelectorContract, v2ListSelectorContract } from '@/lib/api/contracts/v2/selectors'
import { v2PreviewWorkflowImportContract } from '@/lib/api/contracts/v2/workflows'
import {
  v2GetWorkspaceOperationContract,
  v2ListWorkspaceOperationsContract,
} from '@/lib/api/contracts/v2/workspace-operations'
import { defineOpenApiRoute } from '@/lib/api/openapi/types'
import { selectorOperations } from '@/lib/selectors/application/operations'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { workspaceOperations } from '@/lib/workspaces/operations/operations'

export const workspaceSyncOpenApiRoutes = [
  defineOpenApiRoute(
    v2PreviewWorkflowImportContract,
    {
      applicationOperation: workflowOperations.importPreview,
      operationId: 'previewWorkflowImport',
      summary: 'Preview Workflow Import',
      description: `Validate destination mappings and dependent choices without creating a workflow. Returns unresolved fields, discovery instructions, and a fingerprint required by mapped import. No source workspace is queried from imported provenance.`,
      tags: ['Workspace Sync'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The operation result.' },
    },
    {
      query: documentedSchema(
        v2PreviewWorkflowImportContract.query,
        'PreviewWorkflowImportQuery',
        'PreviewWorkflowImport query',
        'The query for this operation.'
      ),
      body: v2PreviewWorkflowImportContract.body,
      response: documentedSchema(
        v2PreviewWorkflowImportContract.response.schema,
        'PreviewWorkflowImportResponse',
        'PreviewWorkflowImport response',
        'The response for this operation.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListSelectorContract,
    {
      applicationOperation: selectorOperations.execute,
      operationId: 'listSelector',
      summary: 'List Selector Options',
      description: `List workspace-scoped configuration choices using the selector key and dependencies from an import or sync preview. Missing OAuth connections require human authorization before provider choices can be discovered. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Workspace Sync'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The operation result.' },
    },
    {
      query: documentedSchema(
        v2ListSelectorContract.query,
        'ListSelectorQuery',
        'ListSelector query',
        'The query for this operation.'
      ),
      body: documentedSchema(
        v2ListSelectorContract.body,
        'ListSelectorBody',
        'ListSelector body',
        'The body for this operation.'
      ),
      response: documentedSchema(
        v2ListSelectorContract.response.schema,
        'ListSelectorResponse',
        'ListSelector response',
        'The response for this operation.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetSelectorContract,
    {
      applicationOperation: selectorOperations.execute,
      operationId: 'getSelector',
      summary: 'Get Selector Option',
      description: `Resolve a workspace configuration option by its provider identifier and declared dependencies. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Workspace Sync'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The operation result.' },
    },
    {
      query: documentedSchema(
        v2GetSelectorContract.query,
        'GetSelectorQuery',
        'GetSelector query',
        'The query for this operation.'
      ),
      body: documentedSchema(
        v2GetSelectorContract.body,
        'GetSelectorBody',
        'GetSelector body',
        'The body for this operation.'
      ),
      response: documentedSchema(
        v2GetSelectorContract.response.schema,
        'GetSelectorResponse',
        'GetSelector response',
        'The response for this operation.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetWorkspaceOperationContract,
    {
      applicationOperation: workspaceOperations.read,
      operationId: 'getWorkspaceOperation',
      summary: 'Get Workspace Operation',
      description: `Read a committed operation, copy progress, exact deployment readiness, and structured issues. A failed follow-up does not mean the business transaction was rolled back.`,
      tags: ['Workspace Sync'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The operation result.' },
    },
    {
      query: documentedSchema(
        v2GetWorkspaceOperationContract.query,
        'GetWorkspaceOperationQuery',
        'GetWorkspaceOperation query',
        'The query for this operation.'
      ),
      params: documentedSchema(
        v2GetWorkspaceOperationContract.params,
        'GetWorkspaceOperationParams',
        'GetWorkspaceOperation params',
        'The params for this operation.'
      ),
      response: documentedSchema(
        v2GetWorkspaceOperationContract.response.schema,
        'GetWorkspaceOperationResponse',
        'GetWorkspaceOperation response',
        'The response for this operation.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListWorkspaceOperationsContract,
    {
      applicationOperation: workspaceOperations.read,
      operationId: 'listWorkspaceOperations',
      summary: 'List Workspace Operations',
      description: `Page committed operations newest first. Filter by the original request ID to reconcile an uncertain mutation response.`,
      tags: ['Workspace Sync'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The operation result.' },
    },
    {
      query: documentedSchema(
        v2ListWorkspaceOperationsContract.query,
        'ListWorkspaceOperationsQuery',
        'ListWorkspaceOperations query',
        'The query for this operation.'
      ),
      params: documentedSchema(
        v2ListWorkspaceOperationsContract.params,
        'ListWorkspaceOperationsParams',
        'ListWorkspaceOperations params',
        'The params for this operation.'
      ),
      response: documentedSchema(
        v2ListWorkspaceOperationsContract.response.schema,
        'ListWorkspaceOperationsResponse',
        'ListWorkspaceOperations response',
        'The response for this operation.'
      ),
    }
  ),
]
