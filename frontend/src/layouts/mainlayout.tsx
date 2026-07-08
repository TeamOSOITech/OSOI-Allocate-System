import Sidebar from "../components/sidebar";
import Header from "../components/header";

const MainLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <div style={{ display: "flex" }}>
      <Sidebar />
      <div style={{ flex: 1 }}>
        <Header />
        <main style={{ padding: "20px", background: "#f8fafc", minHeight: "100vh" }}>
          {children}
        </main>
      </div>
    </div>
  );
};

export default MainLayout;