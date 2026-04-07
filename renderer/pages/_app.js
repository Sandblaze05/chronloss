import Head from "next/head";
import { Geist, Geist_Mono } from "next/font/google";
import "../styles/globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export default function App({ Component, pageProps }) {
  return (
    <>
      <Head>
        <title>Chronloss</title>
        <meta name="description" content="" />
        {/* Add any other global meta tags here */}
      </Head>

      <main
        className={`${geistSans.variable} ${geistMono.variable}`}
      >
          <Component {...pageProps} />
      </main>
    </>
  );
}