import Link from 'next/link';
import {notFound} from 'next/navigation';
import {requireAdmin} from '@/lib/auth';
import {getAdminPurificationRequest} from '@/lib/purification-domain';
import {ReningHoldings,date,statusLabel} from '@/components/purification/views';
import {ReningReviewForm} from '@/components/purification/forms';
import {AdminHeading} from '@/components/admin/common';
export default async function AdminCase({params}:{params:Promise<{id:string}>}){const u=await requireAdmin(),r=await getAdminPurificationRequest(u.id,(await params).id);if(!r)notFound();return <><AdminHeading title="Reningsärende" description={`${r.studentName} · ${r.studentEmail} · ${statusLabel[r.status]}`} action={<Link href="/admin/rening" className="button button-secondary">Alla ärenden</Link>}/><section className="panel stack"><h2>Inskickat innehav</h2><p>{date(r.createdAt)} · {r.creditsUsed} reningar · ID {r.id}</p><ReningHoldings holdings={r.holdings}/>{r.message&&<p className="rening-response">{r.message}</p>}</section><section className="panel stack"><h2>Handläggning och svar</h2><p>Svaret visas för eleven när status är Klart. Interna anteckningar är bara synliga i administrationen.</p><ReningReviewForm request={r}/></section></>;}
