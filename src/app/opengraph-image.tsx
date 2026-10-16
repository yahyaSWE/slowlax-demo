import { ImageResponse } from "next/og";
export const alt = "Slowlax – investera med dina värderingar";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{display:"flex",width:"100%",height:"100%",background:"#000",color:"#fff",padding:"70px 80px",flexDirection:"column",justifyContent:"space-between"}}>
      <div style={{display:"flex",fontSize:48,fontWeight:700,letterSpacing:4}}>SLOWLAX<span style={{color:"#dd9933"}}>↗</span></div>
      <div style={{display:"flex",flexDirection:"column",gap:14}}><div style={{fontSize:66,lineHeight:1.15}}>Investera i aktier.</div><div style={{fontSize:60,lineHeight:1.15,color:"#dd9933"}}>Med dina värderingar.</div></div>
      <div style={{display:"flex",fontSize:25,borderTop:"1px solid #444",paddingTop:25,justifyContent:"space-between"}}><div>Kunskap · Kurser · Gemenskap</div><div>slowlax.se</div></div>
    </div>, size,
  );
}
