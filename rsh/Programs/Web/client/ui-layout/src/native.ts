/** Optional Native Client AppFrame installer over the shared SlotRuntime. */
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/native'
import type {} from '@deepseek-ai/dsh-client-ui-session/native'
import type {} from '@deepseek-ai/dsh-client-locale/native'
import type {} from '@deepseek-ai/dsh-client-ui-theme/native'
import { NativeAppFrame } from './client/AppFrame.tsx'
import { createLayoutStore, type LayoutInfo } from './client/stores.ts'
import { LayoutController, type ILayout } from './client/service.ts'
import type { PanelInfo } from './client/service.ts'
import { ThemePresenter } from './client/theme-presenter.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    sidebar: { kind: 'single'; scope: 'root'; owner: { collapsed: boolean; width: number } }
    main: { kind: 'keyed'; scope: 'root' }
    rightbar: { kind: 'single'; scope: 'root'; owner: { width: number; viewportWidth: number; canShow: boolean } }
    'shell.overlay': { kind: 'list'; scope: 'root' }
  }
}

/** Native layout actions consumed by optional shell surfaces. */
export interface NativeLayoutService extends ILayout {
  /** Current geometry and panel visibility. */
  readonly layoutInfo: HostObservable<LayoutInfo>
  /** Toggle the optional right panel while preserving its last width. */
  toggleRightbar(): void
  /** Read whether the right panel is currently open. */
  isRightbarShown(): boolean
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices {
    /** AppFrame geometry and navigation actions. */
    clientNativeLayout: NativeLayoutService
  }
}

/** Three-column Native AppFrame, composed only through native SlotRuntime registrations. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-client-ui-layout',
  targets: ['client'],
  requires: ['clientSlots', 'clientLocale', 'clientNativeTheme', 'clientNativeSessionPresentation'],
  provides: ['clientNativeLayout'],
  resolve: () => (context) => {
    const slots = context.require('clientSlots')
    const handle = createLayoutStore()
    const instance = handle.create()
    const store: typeof handle = { ...handle, create: () => instance }
    const layout = new LayoutController(instance.actions, id =>
      slots.entries('main').some(entry => entry.options.key === id))
    const layoutInfo: HostObservable<LayoutInfo> = {
      getSnapshot: () => instance.getSnapshot().layoutInfo,
      subscribe: listener => instance.subscribe(listener),
    }
    const nativeLayout: NativeLayoutService = {
      selectPanel: (id) => { layout.selectPanel(id) },
      beginNavigation: () => layout.beginNavigation(),
      toggleSidebar: () => { layout.toggleSidebar() },
      openRightbar: (track, fullscreen) => { layout.openRightbar(track, fullscreen) },
      closeRightbar: () => { layout.closeRightbar() },
      layoutInfo,
      toggleRightbar: () => {
        if (instance.getSnapshot().layoutInfo.rightbarShown) layout.closeRightbar()
        else layout.openRightbar(true, false)
      },
      isRightbarShown: () => instance.getSnapshot().layoutInfo.rightbarShown,
    }
    context.provide('clientNativeLayout', nativeLayout)
    context.own(() => { layout.dispose() })

    const panelInfo: HostObservable<PanelInfo> = {
      getSnapshot: () => instance.getSnapshot().panelInfo,
      subscribe: listener => instance.subscribe(listener),
    }
    const retainMainPanels = (): void => {
      instance.actions.retainMainPanels(slots.entries('main').flatMap(entry =>
        entry.options.key === undefined ? [] : [entry.options.key]))
    }
    context.own(slots.subscribe('main', retainMainPanels))
    context.own(slots.register({
      name: 'root',
      locale: 'common',
      children: {
        sidebar: { kind: 'single', scope: 'root' },
        main: { kind: 'keyed', scope: 'root' },
        rightbar: { kind: 'single', scope: 'root' },
        'shell.overlay': { kind: 'list', scope: 'root' },
      },
      store,
      inject: () => ({ hooks: {
        panelInfo,
        layoutInfo,
        currentSessionTitle: context.require('clientNativeSessionPresentation').currentTitle,
      } }),
    }, NativeAppFrame))
    retainMainPanels()

    const theme = context.require('clientNativeTheme')
    const presenter = new ThemePresenter()
    presenter.apply(theme.getSnapshot())
    const unsubscribe = theme.subscribe(() => { presenter.apply(theme.getSnapshot()) })
    context.own(() => { unsubscribe(); presenter.dispose() })
  },
}

export type { LayoutInfo } from './client/stores.ts'
export type { MainPanelId, PanelInfo, ILayout } from './client/service.ts'
