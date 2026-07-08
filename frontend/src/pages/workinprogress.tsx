import React, { useState, useEffect } from "react";

const MOBILE_BREAKPOINT = 768;

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined"
      ? window.innerWidth < MOBILE_BREAKPOINT
      : false
  );

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);

    window.addEventListener("resize", onResize);

    return () => window.removeEventListener("resize", onResize);
  }, []);

  return isMobile;
}

export default function WorkInProgress() {
   const isMobile = useIsMobile();
  return (
    <div style={styles.container}>
      <div
  style={{
    ...styles.card,
    ...(isMobile ? styles.cardMobile : {}),
  }}
>
        <div
  style={{
    ...styles.icon,
    ...(isMobile ? styles.iconMobile : {}),
  }}
>
  🚧

</div>
<p></p>
<p></p>

        <h1
  style={{
    ...styles.title,
    ...(isMobile ? styles.titleMobile : {}),
  }}
>
  Work in Progress
</h1>

        <p
  style={{
    ...styles.description,
    ...(isMobile ? styles.descriptionMobile : {}),
  }}
>
  We're currently building this module to provide you with a better
  experience.
</p>

        <div
  style={{
    ...styles.status,
    ...(isMobile ? styles.statusMobile : {}),
  }}
>
  <span style={styles.dot}></span>
  Development in Progress
</div>

       <button
  style={{
    ...styles.button,
    ...(isMobile ? styles.buttonMobile : {}),
  }}
>
  Coming Soon
</button>
      </div>
    </div>
  );
}

const styles: any = {
container: {
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  width: "100%",
  height: "100%",
  flex: 1,
  padding: "20px",
  boxSizing: "border-box",
},

  card: {
    width: "100%",
    maxWidth: "650px",
    background: "#fff",
    borderRadius: "16px",
    padding: "50px 40px",
    textAlign: "center",
    boxShadow: "0 10px 35px rgba(0,0,0,0.08)",
    border: "1px solid #ececec",
  },

  cardMobile: {
  maxWidth: "100%",
  padding: "30px 20px",
  borderRadius: "12px",
},

  icon: {
    fontSize: "70px",
    marginBottom: "20px",
  },

  iconMobile: {
  fontSize: "50px",
},

  title: {
    margin: 0,
    color: "#1f2937",
    fontSize: "32px",
    fontWeight: 700,
  },
  titleMobile: {
  fontSize: "24px",
},

  description: {
    marginTop: "18px",
    color: "#6b7280",
    fontSize: "16px",
    lineHeight: "28px",
  },
descriptionMobile: {
  fontSize: "14px",
  lineHeight: "22px",
},
  status: {
    marginTop: "30px",
    display: "inline-flex",
    alignItems: "center",
    gap: "10px",
    padding: "10px 18px",
    borderRadius: "50px",
    background: "#FFF4E5",
    color: "#B45309",
    fontWeight: 600,
    fontSize: "14px",
  },


  statusMobile: {
  fontSize: "12px",
  padding: "8px 14px",
},

  dot: {
    width: "10px",
    height: "10px",
    borderRadius: "50%",
    background: "#F59E0B",
  },

  button: {
    marginTop: "35px",
    padding: "12px 28px",
    border: "none",
    borderRadius: "8px",
    background: "linear-gradient(135deg,#E53935,#C62828)",
    color: "#fff",
    fontWeight: 600,
    fontSize: "15px",
    cursor: "default",
  },
  buttonMobile: {
  width: "100%",
  padding: "12px",
  fontSize: "14px",
},
};