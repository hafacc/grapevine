import type { Metadata } from "next";
import type { ReactElement } from "react";
import DocPage, { H2, List, link, P } from "../../components/doc-page";
import { CONTACT_EMAIL, ISSUES_URL } from "../../utils/contact";

export const metadata: Metadata = {
  title: "help — grapevine",
  description: "Rating, your vine, and where to reach a person.",
};

export default function HelpPage(): ReactElement {
  return (
    <DocPage title="help" route="/help/">
      <H2>rating</H2>
      <List>
        <li>Swipe a row right for yes, left for no.</li>
        <li>Swipe the same way again to undo.</li>
        <li>
          Type in the field at the bottom to search, or to add a new thing.
        </li>
        <li>
          Adding a thing offers matches from Wikipedia and OpenStreetMap. Turn
          it off on the people screen.
        </li>
        <li>Open a thing to rate its attributes the same way.</li>
        <li>The eye hides what you've already rated.</li>
        <li>Report a bad name at the bottom of its screen.</li>
      </List>

      <H2>searching</H2>
      <List>
        <li>
          Type several words: “starbucks quiet” puts quiet starbucks first.
        </li>
        <li>Start a word with ! to see the lowest-rated first.</li>
        <li>Start it with @ to look at names only, # at attributes only.</li>
      </List>

      <H2>your vine</H2>
      <List>
        <li>grapevine is invite-only. To join, open someone's link.</li>
        <li>Tap your avatar to see your vine.</li>
        <li>
          Copy your link and send it to someone. When they open it and confirm,
          you're in each other's vines.
        </li>
        <li>Turn your link off, or replace it, at any time.</li>
        <li>Swipe someone's row to remove them from your vine.</li>
        <li>
          Remove the last person and your account is locked until someone sends
          you a link.
        </li>
        <li>Change your name on your own row.</li>
      </List>

      <H2>a recommendation is wrong</H2>
      <P>
        <strong>Thumb it down.</strong> That teaches grapevine whose taste
        matches yours.
      </P>

      <H2>my list is empty</H2>
      <P>
        Your list is built from your vine's thumbs, so add someone to it. A new
        rating can take a few minutes to reach you.
      </P>

      <H2>contact</H2>
      <List>
        <li>
          Bugs and questions:{" "}
          <a className={link} href={ISSUES_URL}>
            GitHub issues
          </a>
        </li>
        <li>
          Anything private:{" "}
          <a className={link} href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
        </li>
      </List>
    </DocPage>
  );
}
