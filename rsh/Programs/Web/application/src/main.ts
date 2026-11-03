/** Browser entry for the Web client. */
import '@redspark/rsh-client-web/base.css'
import { AppWebEntry } from '@redspark/rsh-web-compatibility'

const el = document.getElementById('root')
if (el === null) throw new Error('web app: missing #root')
void new AppWebEntry(el).run()
