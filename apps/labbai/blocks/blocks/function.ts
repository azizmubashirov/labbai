import { CodeIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { CodeExecutionOutput } from '@/tools/function/types'

export const FunctionBlock: BlockConfig<CodeExecutionOutput> = {
  type: 'function',
  name: 'Function',
  description: 'Run custom logic',
  longDescription:
    'This is a core workflow block. Execute custom JavaScript code within your workflow. The code runs in an isolated local VM.',
  bestPractices: `
  - JavaScript runs in an isolated local VM. Third-party packages cannot be imported; use the built-in fetch and standard JavaScript APIs.
  - Can reference workflow variables using <blockName.output> syntax as usual within code. Avoid XML/HTML tags.
  - To read a file from an earlier block inline, use <blockName.files[0].base64>.
  `,
  category: 'blocks',
  bgColor: '#FF402F',
  icon: CodeIcon,
  canvasPresentation: {
    defaultTitle: 'Function',
    sentences: { default: [{ text: 'Run', field: 'code', core: true }] },
  },
  subBlocks: [
    {
      id: 'code',
      title: 'Code',
      type: 'code',
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert JavaScript programmer.
Generate ONLY the raw body of a JavaScript function based on the user's request. Never wrap in markdown formatting.
The code should be executable within an 'async function(params, environmentVariables) {...}' context.
- 'params' (object): Contains input parameters derived from the JSON schema. Access these directly using the parameter name wrapped in angle brackets, e.g., '<paramName>'. Do NOT use 'params.paramName'.
- 'environmentVariables' (object): Contains environment variables. Reference these using the double curly brace syntax: '{{ENV_VAR_NAME}}'. Do NOT use 'environmentVariables.VAR_NAME' or env.

Current code context: {context}

IMPORTANT FORMATTING RULES:
1. Reference Environment Variables: Use the exact syntax {{VARIABLE_NAME}}. Prefer the unquoted form when the placeholder is the complete expression (for example, 'const apiKey = {{SERVICE_API_KEY}};'). Quoted and embedded string forms such as '"Bearer {{SERVICE_API_KEY}}"', template literals, and JavaScript regex literals are also supported. The resolved value is bound separately from the source at execution time, preserving its exact string contents.
2. Reference Input Parameters/Workflow Variables: Use the exact syntax <variable_name>. Do NOT wrap it in quotes (e.g., use 'userId = <userId>;' not 'userId = "<userId>";'). This includes parameters defined in the block's schema and outputs from previous blocks.
3. Function Body ONLY: Do NOT include the function signature (e.g., 'async function myFunction() {' or the surrounding '}').
4. Imports: Do NOT import or require any module. Use the built-in fetch and standard JavaScript APIs.
5. Output: Ensure the code returns a value if the function is expected to produce output. Use 'return'.
6. Clarity: Write clean, readable code.
7. No Explanations: Do NOT include markdown formatting, comments explaining the rules, or any text other than the raw JavaScript code for the function body.

Example Scenario:
User Prompt: "Fetch user data from an API. Use the User ID passed in as 'userId' and an API Key stored as the 'SERVICE_API_KEY' environment variable."

Generated Code:
const userId = <block.content>; // Correct: Accessing input parameter without quotes
const apiKey = {{SERVICE_API_KEY}}; // Correct: Accessing environment variable without quotes
const url = \`https://api.example.com/users/\${userId}\`;

try {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': \`Bearer \${apiKey}\`,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    // Throwing an error will mark the block execution as failed
    throw new Error(\`API request failed with status \${response.status}: \${await response.text()}\`);
  }

  const data = await response.json();
  console.log('User data fetched successfully.'); // Optional: logging for debugging
  return data; // Return the fetched data which becomes the block's output
} catch (error) {
  console.error(\`Error fetching user data: \${error.message}\`);
  // Re-throwing the error ensures the workflow knows this step failed.
  throw error;
}`,
        placeholder: 'Describe the function you want to create...',
        generationType: 'javascript-function-body',
      },
    },
    {
      id: 'secretScope',
      title: 'Secret access',
      type: 'dropdown',
      // Only meaningful when an agent calls this block as a tool.
      context: 'tool-input',
      paramVisibility: 'user-only',
      options: [
        { label: 'All secrets', id: 'all' },
        { label: 'Selected secrets', id: 'selected' },
      ],
      value: () => 'all',
      description:
        'Code can read any workspace secret, including ones added later. Narrow this to advertise a specific set to the model.',
    },
    {
      id: 'mountedSecrets',
      title: 'Secrets',
      type: 'dropdown',
      selectorKey: 'workspace.secretNames',
      context: 'tool-input',
      paramVisibility: 'user-only',
      multiSelect: true,
      searchable: true,
      /**
       * Secret names are case-sensitive because code references the exact `{{NAME}}`,
       * so the picker must preserve the displayed casing.
       */
      preserveLabelCase: true,
      condition: { field: 'secretScope', value: 'selected' },
      placeholder: 'Select secrets this tool can read',
    },
  ],
  tools: {
    access: ['function_execute'],
  },
  inputs: {
    code: { type: 'string', description: 'JavaScript code to execute' },
    timeout: { type: 'number', description: 'Execution timeout' },
    secretScope: { type: 'string', description: 'Secret access mode: all or selected' },
    mountedSecrets: {
      type: 'json',
      description: 'Workspace secret names this block may read when secretScope is selected',
    },
  },
  outputs: {
    result: { type: 'json', description: 'Structured result emitted by the executed code' },
    stdout: {
      type: 'string',
      description: 'Console log output and debug messages from function execution',
    },
  },
}
