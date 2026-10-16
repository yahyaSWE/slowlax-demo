import Link from 'next/link';
import {requireAdmin} from '@/lib/auth';
import {getAdminPurificationRequests,type PurificationStatus} from '@/lib/purification-domain';
import {ReningRequestList,statusLabel} from '@/components/purification/views';
import {AdminHeading} from '@/components/admin/common';
export default async function ReningAdmin({searchParams}:{searchParams:Promise<{status?:string}>}){const u=await requireAdmin(),s=(await searchParams).status,status=s&&Object.hasOwn(statusLabel,s)?s as PurificationStatus:undefined,requests=await getAdminPurificationRequests(u.id,{status});return <><AdminHeading title="Rening – ärenden" description="Handlägg elevernas innehav och publicera ett privat svar i deras elevportal." action={<Link className="button button-primary" href="/admin/rening/installningar">Erbjudanden och inställningar</Link>}/><div className="membership-actions"><Link className="text-link" href="/admin/rening">Alla</Link>{Object.entries(statusLabel).map(([k,v])=><Link className="text-link" key={k} href={'/admin/rening?status='+k}>{v}</Link>)}</div><ReningRequestList requests={requests} admin/></>;}
