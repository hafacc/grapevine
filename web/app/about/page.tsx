import type { Metadata } from "next";
import Link from "next/link";
import type { ReactElement } from "react";
import DocPage, { H2, link, P } from "../../components/doc-page";
import { HAFA_URL, REPO_URL } from "../../utils/contact";

export const metadata: Metadata = {
  title: "about grapevine",
  description:
    "Recommendations from the people you know, weighted by whose taste has matched yours.",
};

export default function AboutPage(): ReactElement {
  return (
    <DocPage title="about grapevine" route="/about/">
      <P>
        grapevine is a way to find things worth your time by asking the people
        you already know. You give things a thumb up or down; so do your
        friends, and their friends. What you get back is your own ranking, built
        from whose taste has actually turned out to predict yours.
      </P>

      <H2>the three things worth knowing</H2>
      <P>
        <strong>Every ranking is personal.</strong> There is no global score, no
        average, no “4.6 stars”. Two people looking at the same restaurant see
        two different answers, because the answer is built out of their own
        ratings and their own network. Nothing here can be gamed for status,
        because there is no status to win.
      </P>
      <P>
        <strong>Nothing ever shows who rated what.</strong> No counts, no lists
        of raters, no “three friends liked this”, no explanation of where a
        recommendation came from. A thing's standing with you is one bar with no
        word beside it, and that is the whole of it.
      </P>
      <P>
        <strong>
          How far a stranger's opinion travels is bounded by friendships, not by
          accounts.
        </strong>{" "}
        Everything reached through one friend weighs, altogether, at most as
        much as that friend does — so a thousand invented accounts behind one
        friendship are worth no more than one.{" "}
        <Link className={link} href="/how/">
          How it works
        </Link>{" "}
        walks through the whole mechanism, with the formulas folded away under
        each part and the limits stated as plainly as the promises.
      </P>

      <H2>what you can do with it</H2>
      <P>
        <strong>One list.</strong> Your ranking, with a field at the bottom that
        searches it by name and by tag at once and adds whatever you type if it
        is not there yet. A thing is anything with a name — a restaurant, a
        film, a trail, a brand of olive oil — and a thing <em>is</em> its name,
        so “Café Bleu” and “café bleu” are one thing rather than two, and typing
        “cafe bleu” finds it too. You can rate the tags on it too:{" "}
        <code>cheap</code>, <code>loud</code>, <code>date-night</code>.
      </P>
      <P>
        <strong>A swipe.</strong> Right is yes, left is no, and swiping the way
        you already voted takes it back. A rated row can be hidden from the
        list.
      </P>
      <P>
        <strong>People.</strong> Connections are mutual and by invitation — find
        someone by username and ask. Your friend list is visible only to you.
      </P>

      <H2>who makes it</H2>
      <P>
        grapevine is a{" "}
        <a className={link} href={HAFA_URL}>
          hafa.cc
        </a>{" "}
        project. It doesn't charge, doesn't show ads, and doesn't sell anything
        — including data. What it knows about you and why is written down in the{" "}
        <Link className={link} href="/privacy/">
          Privacy Policy
        </Link>
        . If something's broken, the{" "}
        <Link className={link} href="/help/">
          Help page
        </Link>{" "}
        says how to reach a person.
      </P>
      <P>
        The code is open source under the MIT license:{" "}
        <a className={link} href={REPO_URL}>
          {REPO_URL.replace(/^https:\/\//, "")}
        </a>
        . Every version of the app — and of these pages — is public in that
        repository's history.
      </P>
    </DocPage>
  );
}
