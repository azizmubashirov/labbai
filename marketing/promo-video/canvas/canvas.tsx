/**
 * Renders the promo's workflow with the app's own canvas components
 * (`WorkflowBlockView`, `WorkflowEdgeView`, `SubBlockRowView`) inside React Flow,
 * so the video shows real Labbai block cards. promo.html drives it frame by frame
 * through `window.labbaiCanvas`.
 */
import './prism-global'
import type { ReactNode } from 'react'
import { useSyncExternalStore } from 'react'
import { Tooltip } from '@sim/emcn'
import {
  type BlockRunStatus,
  SubBlockRowView,
  WorkflowBlockView,
  WorkflowEdgeView,
} from '@sim/workflow-renderer'
import {
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  ReactFlow,
  ReactFlowProvider,
} from '@xyflow/react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import {
  AgentIcon,
  CalComIcon,
  PackageSearchIcon,
  TelegramIcon,
} from '../../../apps/sim/components/icons'

interface BlockSpec {
  type: string
  name: string
  typeLabel?: string
  Icon: (props: { className?: string }) => ReactNode
  iconBgColor: string
  isIntegration: boolean
  rows: [string, string][]
}

const BLOCKS: Record<string, BlockSpec> = {
  tg: {
    type: 'telegram',
    name: 'Telegram',
    typeLabel: 'Trigger',
    Icon: TelegramIcon,
    iconBgColor: '#FFFFFF',
    isIntegration: true,
    rows: [
      ['Trigger', 'New message'],
      ['Bot', '@barber_studio_bot'],
    ],
  },
  kb: {
    type: 'knowledge',
    name: 'Price list',
    typeLabel: 'Knowledge',
    Icon: PackageSearchIcon,
    iconBgColor: '#00B0B0',
    isIntegration: false,
    rows: [
      ['Operation', 'Search'],
      ['Knowledge Base', 'Barber prices'],
      ['Search Query', '<telegram.text>'],
    ],
  },
  agent: {
    type: 'agent',
    name: 'Barber agent',
    typeLabel: 'Agent',
    Icon: AgentIcon,
    iconBgColor: 'var(--brand)',
    isIntegration: false,
    rows: [
      ['Model', 'gpt-5-mini'],
      ['System Prompt', 'Barber Studio assistant'],
      ['User Prompt', '<telegram.text>'],
    ],
  },
  cal: {
    type: 'calcom',
    name: 'Book visit',
    typeLabel: 'Cal.com',
    Icon: CalComIcon,
    iconBgColor: '#292929',
    isIntegration: true,
    rows: [
      ['Operation', 'Create Booking'],
      ['Event Type', 'Haircut + beard'],
      ['Start Time', '<agent.start>'],
    ],
  },
  reply: {
    type: 'telegram',
    name: 'Reply',
    typeLabel: 'Telegram',
    Icon: TelegramIcon,
    iconBgColor: '#FFFFFF',
    isIntegration: true,
    rows: [
      ['Operation', 'Send Message'],
      ['Message', '<agent.content>'],
    ],
  },
}

const ORDER = ['tg', 'kb', 'agent', 'cal', 'reply'] as const

const NODES: Node[] = ORDER.map((id, i) => ({
  id,
  type: 'block',
  position: { x: i * 280, y: i % 2 === 0 ? 36 : 0 },
  data: {},
  draggable: false,
  selectable: false,
}))

const EDGES: Edge[] = ORDER.slice(1).map((id, i) => ({
  id: `e${i}`,
  source: ORDER[i],
  target: id,
  sourceHandle: 'source',
  targetHandle: 'target',
  type: 'workflow',
}))

let runDone = new Set<string>()
const listeners = new Set<() => void>()
const store = {
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  get: () => runDone,
}

function BlockNode({ id }: NodeProps) {
  const done = useSyncExternalStore(store.subscribe, store.get)
  const spec = BLOCKS[id]
  const status: BlockRunStatus = done.has(id) ? 'success' : undefined
  return (
    <WorkflowBlockView
      id={id}
      type={spec.type}
      name={spec.name}
      typeLabel={spec.typeLabel}
      isEnabled
      isLocked={false}
      hasRing={false}
      ringStyles=''
      runPathStatus={status}
      isExecutionHighlighted={done.has(id)}
      Icon={spec.Icon}
      iconBgColor={spec.iconBgColor}
      isIntegration={spec.isIntegration}
      horizontalHandles
      shouldShowDefaultHandles
      hasContentBelowHeader
      conditionRows={[]}
      routerRows={[]}
      wouldCreateConnectionCycle={() => false}
      rows={spec.rows.map(([title, value]) => (
        <SubBlockRowView key={title} title={title} displayValue={value} />
      ))}
    />
  )
}

function FlowEdge(props: EdgeProps<Edge>) {
  const done = useSyncExternalStore(store.subscribe, store.get)
  const ran = done.has(props.target)
  return (
    <WorkflowEdgeView
      {...props}
      data={{}}
      diffStatus={null}
      runStatus={ran ? 'success' : undefined}
      isPreviewRun={false}
    />
  )
}

const nodeTypes = { block: BlockNode }
const edgeTypes = { workflow: FlowEdge }

function Canvas() {
  return (
    <Tooltip.Provider>
      <ReactFlowProvider>
        <ReactFlow
          nodes={NODES}
          edges={EDGES}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          defaultViewport={{ x: 26, y: 105, zoom: 1.25 }}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
          panOnDrag={false}
          zoomOnScroll={false}
        />
      </ReactFlowProvider>
    </Tooltip.Provider>
  )
}

declare global {
  interface Window {
    labbaiCanvas: {
      ready: Promise<void>
      /** Marks these block ids as successfully run (edges into them turn green). */
      setRun: (ids: string[]) => void
    }
  }
}

const mount = document.getElementById('labbai-canvas')
if (mount) {
  flushSync(() => createRoot(mount).render(<Canvas />))
}

window.labbaiCanvas = {
  ready: new Promise((resolve) => {
    const check = () => {
      const edges = document.querySelectorAll('.react-flow__edge path')
      if (edges.length >= EDGES.length) resolve()
      else requestAnimationFrame(check)
    }
    check()
  }),
  setRun(ids) {
    const key = ids.join(',')
    if (key === [...runDone].join(',')) return
    runDone = new Set(ids)
    flushSync(() => {
      for (const listener of listeners) listener()
    })
  },
}
