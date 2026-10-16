import Link from 'next/link';
import {notFound} from 'next/navigation';
import {requireUser} from '@/lib/auth';
import {getUserPurificationRequest} from '@/lib/purification-domain';
import {ReningHoldings,date,statusLabel} from '@/components/purification/views';
import {ReningCancelForm} from '@/components/purification/forms';
import {PRIVATE_METADATA} from '@/lib/seo';
export const metadata={...PRIVATE_METADATA,title:'Mitt reningsärende'};
export const dynamic='force-dynamic';
export default async function Case({params}:{params:Promise<{id:string}>}){const user=await requireUser();if(user.role!=='student')notFound();const r=await getUserPurificationRequest(user.id,(await params).id);if(!r)notFound();return <><Link href="/elevportal/rening" className="back-link">Alla mina reningsärenden</Link><header className="membership-hero"><p className="eyebrow">{statusLabel[r.status]}</p><h1 className="page-title">Mitt reningsärende</h1><p>Inskickat {date(r.createdAt)} · {r.creditsUsed} reningar</p></header><section className="panel stack"><h2>Mitt innehav</h2><ReningHoldings holdings={r.holdings}/>{r.message&&<p className="rening-response">{r.message}</p>}</section>{r.responseText?<section className="panel stack"><h2>Svar från Slowlax</h2><p className="small muted">Publicerat {date(r.responsePublishedAt!)}</p><div className="rening-response">{r.responseText}</div></section>:<p className="notice">{r.status==='rejected'?'Ärendet har avvisats. Reservationen är återlämnad enligt tilldelningens giltighetstid. Kontakta oss om du behöver hjälp.':r.status==='cancelled'?'Ärendet är avbrutet. Reservationen är återlämnad enligt tilldelningens giltighetstid.':'Du kan läsa svaret här när granskningen är klar.'}</p>}{r.canCancel&&<section className="panel"><ReningCancelForm request={r}/></section>}<p className="small muted">Ärende-ID: {r.id}</p></>;}
