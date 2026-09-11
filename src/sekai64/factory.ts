import {
  Sekai64Renderer,
  type Sekai64RendererOptions,
} from '@blcklab/anyo/renderer-sekai64'
import type { AnimationPluginOptions } from '../types.js'
import { createAnimationPlugin, type AnyoAnimationPlugin } from '../plugin.js'
import {
  Sekai64AnimationAdapter,
  type Sekai64AnimationAdapterOptions,
} from './Sekai64AnimationAdapter.js'

export interface CreateSekai64AnimationRuntimeOptions
  extends Omit<Sekai64RendererOptions, 'assetLoaders'>,
    Pick<AnimationPluginOptions, 'onDiagnostic' | 'strict'> {
  readonly assetLoaders?: Sekai64RendererOptions['assetLoaders']
  readonly assetType?: string
  readonly animationModule?: Sekai64AnimationAdapterOptions['module']
  readonly animationModuleOptions?: Sekai64AnimationAdapterOptions['moduleOptions']
}

export interface Sekai64AnimationRuntime {
  readonly renderer: Sekai64Renderer
  readonly adapter: Sekai64AnimationAdapter
  readonly plugin: AnyoAnimationPlugin
}

export function createSekai64AnimationRuntime(
  options: CreateSekai64AnimationRuntimeOptions,
): Sekai64AnimationRuntime {
  const {
    assetLoaders = [],
    assetType,
    animationModule,
    animationModuleOptions,
    onDiagnostic,
    strict,
    ...rendererOptions
  } = options

  let renderer!: Sekai64Renderer
  const adapter = new Sekai64AnimationAdapter({
    getRenderer: () => renderer,
    ...(assetType ? { assetType } : {}),
    ...(animationModule ? { module: animationModule } : {}),
    ...(animationModuleOptions ? { moduleOptions: animationModuleOptions } : {}),
  })
  renderer = new Sekai64Renderer({
    ...rendererOptions,
    assetLoaders: [...assetLoaders, adapter.createAssetLoader()],
  })
  const plugin = createAnimationPlugin({
    adapter,
    ...(onDiagnostic ? { onDiagnostic } : {}),
    ...(strict !== undefined ? { strict } : {}),
  })
  return Object.freeze({ renderer, adapter, plugin })
}
