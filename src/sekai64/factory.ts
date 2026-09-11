import {
  Sekai64Renderer,
  type Sekai64RendererOptions,
} from '@blcklab/anyo/renderer-sekai64'
import type { AssetLoaderRegistration } from '@blcklab/sekai64/assets'
import type { GltfModelNode } from '@blcklab/sekai64/gltf'
import type { AnimationRendererModule } from '@blcklab/sekai64/animation'
import type { AnimationPluginOptions } from '../types.js'
import { createAnimationPlugin, type AnyoAnimationPlugin } from '../plugin.js'
import {
  Sekai64AnimationAdapter,
  type Sekai64AnimationAdapterOptions,
} from './Sekai64AnimationAdapter.js'


export interface CreateSekai64AnimationIntegrationOptions
  extends Pick<AnimationPluginOptions, 'onDiagnostic' | 'strict'> {
  readonly assetType?: string
  readonly animationModule?: Sekai64AnimationAdapterOptions['module']
  readonly animationModuleOptions?: Sekai64AnimationAdapterOptions['moduleOptions']
}

/**
 * Composition bundle for hosts such as @blcklab/anyo-player.
 *
 * Install `module` through the renderer, `assetLoader` through renderer asset
 * loaders, and `plugin` through Anyo world plugins. A VRM loader can reuse the
 * same `module` so VRM skinning and anyo.animation share one runtime.
 */
export interface Sekai64AnimationIntegration {
  readonly module: AnimationRendererModule
  readonly adapter: Sekai64AnimationAdapter
  readonly assetLoader: AssetLoaderRegistration<GltfModelNode>
  readonly plugin: AnyoAnimationPlugin
}

export function createSekai64AnimationIntegration(
  options: CreateSekai64AnimationIntegrationOptions = {},
): Sekai64AnimationIntegration {
  const adapter = new Sekai64AnimationAdapter({
    ...(options.assetType ? { assetType: options.assetType } : {}),
    ...(options.animationModule ? { module: options.animationModule } : {}),
    ...(options.animationModuleOptions ? { moduleOptions: options.animationModuleOptions } : {}),
  })
  const plugin = createAnimationPlugin({
    adapter,
    ...(options.onDiagnostic ? { onDiagnostic: options.onDiagnostic } : {}),
    ...(options.strict !== undefined ? { strict: options.strict } : {}),
  })
  return Object.freeze({
    module: adapter.module,
    adapter,
    assetLoader: adapter.createAssetLoader(),
    plugin,
  })
}

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
    modules = [],
    ...rendererOptions
  } = options

  const integration = createSekai64AnimationIntegration({
    ...(assetType ? { assetType } : {}),
    ...(animationModule ? { animationModule } : {}),
    ...(animationModuleOptions ? { animationModuleOptions } : {}),
    ...(onDiagnostic ? { onDiagnostic } : {}),
    ...(strict !== undefined ? { strict } : {}),
  })
  const rendererModules = [...modules]
  if (!rendererModules.some((module) => module.id === integration.module.id)) rendererModules.push(integration.module)
  const renderer = new Sekai64Renderer({
    ...rendererOptions,
    modules: rendererModules,
    assetLoaders: [...assetLoaders, integration.assetLoader],
  })
  return Object.freeze({ renderer, adapter: integration.adapter, plugin: integration.plugin })
}
