/** Browser entry for the Web client. */
import '@deepseek-ai/dsh-client-web/base.css'
import { AppWebEntry } from '@deepseek-ai/dsh-web-compatibility'

const el = document.getElementById('root')
if (el === null) throw new Error('web app: missing #root')
void new AppWebEntry(el).run()
