import { nextTick } from 'node:process'
import { Writable } from 'node:stream'
import { Console } from 'node:console'
import { parseErrorStacktrace } from '@vitest/utils/source-map'
import type { BirpcReturn } from 'birpc'
import type { File, Reporter, TaskResultPack, UserConsoleLog, Vitest as VitestCore } from 'vitest'
import type { VitestEvents, VitestMethods } from '../api/rpc'
import { setupFilePath } from '../constants'
import { Vitest } from './vitest'

export class VSCodeReporter implements Reporter {
  private rpc!: BirpcReturn<VitestEvents, VitestMethods>
  private ctx!: VitestCore

  private get collecting(): boolean {
    return this.ctx.configOverride.testNamePattern?.toString() === `/${Vitest.COLLECT_NAME_PATTERN}/`
  }

  init(ctx: VitestCore) {
    this.ctx = ctx
    const server = ctx.server.config.server
    if (!server.fs.allow.includes(setupFilePath))
      server.fs.allow.push(setupFilePath)
    ctx.projects.forEach((project) => {
      project.config.setupFiles = [
        ...project.config.setupFiles || [],
        setupFilePath,
      ]
      const server = project.server.config.server
      if (!server.fs.allow.includes(setupFilePath))
        server.fs.allow.push(setupFilePath)
      const browser = project.browser as any
      if (!browser) {
        return
      }
      const config = 'vite' in browser ? browser.vite.config.server : browser.config.server
      if (!config.fs.allow.includes(setupFilePath))
        config.fs.allow.push(setupFilePath)
    })
  }

  initRpc(rpc: BirpcReturn<VitestEvents, VitestMethods>) {
    this.rpc = rpc
  }

  onUserConsoleLog(log: UserConsoleLog) {
    this.rpc.onConsoleLog(log)
  }

  onTaskUpdate(packs: TaskResultPack[]) {
    packs.forEach(([taskId, result]) => {
      const project = this.ctx.getProjectByTaskId(taskId)

      result?.errors?.forEach((error) => {
        if (typeof error === 'object' && error) {
          error.stacks = parseErrorStacktrace(error, {
            getSourceMap: file => project.getBrowserSourceMapModuleById(file),
          })
        }
      })
    })

    this.rpc.onTaskUpdate(packs)
  }

  async onFinished(files?: File[], errors: unknown[] = this.ctx.state.getUnhandledErrors()) {
    const collecting = this.collecting

    let output = ''
    if (errors.length) {
      const writable = new Writable({
        write(chunk, _encoding, callback) {
          output += String(chunk)
          callback()
        },
      })
      const _console = this.ctx.logger.console
      const errorStream = this.ctx.logger.errorStream
      const outputStream = this.ctx.logger.outputStream
      this.ctx.logger.errorStream = writable as any
      this.ctx.logger.outputStream = writable as any
      this.ctx.logger.console = new Console(writable, writable)
      await this.ctx.logger.printUnhandledErrors(errors)
      this.ctx.logger.console = _console
      this.ctx.logger.errorStream = errorStream
      this.ctx.logger.outputStream = outputStream
    }
    nextTick(() => {
      this.rpc.onFinished(files || [], output, collecting)
    })
  }

  onCollected(files?: File[]) {
    this.rpc.onCollected(files, this.collecting)
  }

  onWatcherStart(files?: File[], errors?: unknown[]) {
    this.rpc.onWatcherStart(files, errors, this.collecting)
  }

  onWatcherRerun(files: string[], trigger?: string) {
    this.rpc.onWatcherRerun(files, trigger, this.collecting)
  }

  toJSON() {
    return {}
  }
}
