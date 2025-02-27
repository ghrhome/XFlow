import { inject, injectable, postConstruct } from 'mana-syringe'
import type { NsGraph } from '../../interface'
import type { IContext, IArgsBase } from '../../command/interface'
import type { IHooks } from '../../hooks/interface'
import type { HookHub } from '@antv/xflow-hook'
import type { Edge as X6Edge } from '@antv/x6'
import { ICommandHandler, ICommandContextProvider } from '../../command/interface'
import { XFlowEdgeCommands } from '../constant'
import { Disposable } from '../../common/disposable'

export type ICommand = ICommandHandler<NsAddEdge.IArgs, NsAddEdge.IResult, NsAddEdge.ICmdHooks>

export namespace NsAddEdge {
  /** Command: 用于注册named factory */
  export const command = XFlowEdgeCommands.ADD_EDGE
  /** hookName */
  export const hookKey = 'addEdge'

  /** hook 参数类型 */
  export interface IArgs extends IArgsBase {
    edgeConfig: NsGraph.IEdgeConfig
    cellFactory?: IEdgeCellFactory
    createIdService?: ICreateEdgeIdService
    createEdgeService?: ICreateEdgeService
  }
  /** hook handler 返回类型 */
  export interface IResult {
    edgeConfig: NsGraph.IEdgeConfig
    edgeCell: X6Edge
  }
  export interface ICreateEdgeService {
    (args: IArgs): Promise<NsGraph.IEdgeConfig>
  }
  export interface ICreateEdgeIdService {
    (edgeConfig: NsGraph.IEdgeConfig): Promise<string>
  }
  export interface IEdgeCellFactory {
    (args: NsGraph.IEdgeConfig, self: AddEdgeCommand): Promise<X6Edge>
  }

  /** hooks 类型 */
  export interface ICmdHooks extends IHooks {
    addEdge: HookHub<IArgs, IResult>
  }
  /** edge id 类型 */
  export const createEdgeId = (edge: NsGraph.IEdgeConfig) => {
    return `${edge.source}:${edge.sourcePortId}-${edge.target}:${edge.targetPortId}`
  }
}

@injectable({
  token: { token: ICommandHandler, named: NsAddEdge.command.id },
})
/** 创建节点命令 */
export class AddEdgeCommand implements ICommand {
  /** api */
  @inject(ICommandContextProvider) contextProvider: ICommand['contextProvider']

  ctx: IContext<NsAddEdge.IArgs, NsAddEdge.IResult, NsAddEdge.ICmdHooks>

  @postConstruct()
  init() {
    this.ctx = this.contextProvider()
  }

  /** 处理edgeConfig的兜底逻辑 */
  processEdgeConfig = async (args: NsAddEdge.IArgs, edge: NsGraph.IEdgeConfig) => {
    /** 处理edgeConfig没有返回id的问题 */
    if (!edge.id) {
      const { createIdService = NsAddEdge.createEdgeId } = args
      edge.id = await createIdService(edge)
    }
    return edge
  }

  /** 执行Cmd */
  execute = async () => {
    const { args, hooks: runtimeHook } = this.ctx.getArgs()
    const hooks = this.ctx.getHooks()

    const result = await hooks.addEdge.call(
      /** 执行 hooks pipeline处理args */
      args,
      /** 执行 callback */
      async handlerArgs => {
        const { cellFactory, createEdgeService, commandService } = handlerArgs
        const edgeConfig = createEdgeService
          ? await createEdgeService(handlerArgs)
          : handlerArgs.edgeConfig
        const graph = await this.ctx.getX6Graph()
        await this.processEdgeConfig(handlerArgs, edgeConfig)
        let edgeCell: X6Edge
        if (cellFactory) {
          const cell = await cellFactory(edgeConfig, this)
          edgeCell = graph.addEdge(cell)
        } else {
          edgeCell = graph.addEdge({
            ...edgeConfig,
            /** 由于X6的实现是React节点挂在label上的, 所以必须要给label设置值 */
            label: edgeConfig?.label || edgeConfig,
            data: { ...edgeConfig },
          })
        }

        /** 创建 undo */
        const undo = Disposable.create(() => {
          commandService.executeCommand(XFlowEdgeCommands.DEL_EDGE.id, {
            x6Edge: edgeCell,
          })
        })
        /** add undo */
        this.ctx.addUndo(undo)

        return { edgeConfig: edgeConfig, edgeCell }
      },
      runtimeHook,
    )

    this.ctx.setResult(result)
    return this
  }

  /** undo cmd */
  undo = async () => {
    this.ctx.undo()
    return this
  }

  /** redo cmd */
  redo = async () => {
    if (!this.isUndoable) {
      await this.execute()
    }
    return this
  }

  isUndoable(): boolean {
    return this.ctx.isUndoable()
  }
}
