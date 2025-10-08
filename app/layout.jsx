import "./globals.css";

export const metadata = {
  title: "MyLyfe Video Maker",
  description: "AI-powered video editing",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}