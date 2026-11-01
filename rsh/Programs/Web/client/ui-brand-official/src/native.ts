/** Native official RedSpark Harness brand occupants for the sidebar brand slots. */
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/native'
import { OfficialBrandMark, OfficialBrandName } from './client/Brand.tsx'

/** Native brand plugin: fills `sidebar.brand.mark` and `sidebar.brand.name` with the official artwork. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-client-ui-brand-official',
  targets: ['client'],
  requires: ['clientSlots'],
  provides: [],
  resolve: () => (context) => {
    // The official build profile gates this package; a non-official Native build keeps
    // the declaring package's animated fallback exactly as the Cordis half does.
    if (process.env.DSH_CLIENT_BUILD_PROFILE !== 'official') return
    const slots = context.require('clientSlots')
    context.own(slots.inject('sidebar.brand.mark', () => slots.register({
      name: 'sidebar.brand.mark',
    }, OfficialBrandMark)))
    context.own(slots.inject('sidebar.brand.name', () => slots.register({
      name: 'sidebar.brand.name',
    }, OfficialBrandName)))
  },
}
