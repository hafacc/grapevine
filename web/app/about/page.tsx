import type { Metadata } from "next";
import type { ReactElement } from "react";
import DocPage, { H2, link, P } from "../../components/doc-page";
import { HAFA_URL, REPO_URL } from "../../utils/contact";

export const metadata: Metadata = {
  title: "about grapevine",
  description:
    "Recommendations from people you trust, and people who share your taste.",
};

export default function AboutPage(): ReactElement {
  return (
    <DocPage title="about grapevine" route="/about/">
      <P>
        grapevine recommends things from the ratings of your vine, the people
        you trust for honest opinions, and, through them, of people who share
        your taste.
      </P>
      <P>
        Your vine doesn't have to share your taste: your list weighs each person
        by how well their thumbs have matched yours.
      </P>
      <P>
        There is no global score or average; two people looking at the same
        thing can see different recommendations.
      </P>

      <H2>rating</H2>
      <P>
        Search for a thing by name. If nobody has added it yet, add it from the
        search.
      </P>
      <P>
        <strong>Swipe a row right for yes, left for no.</strong> Swipe the same
        way again to take it back, or the other way to flip it. On a wide
        screen, use the buttons at either end of the row. Open a thing to rate
        its attributes, like <em>cheap</em> or <em>late night</em>, the same
        way.
      </P>

      <H2>how your list is built</H2>
      <P>
        Someone counts more the more their earlier thumbs matched yours, most of
        all on things people around you disagree about. Everything anyone near
        you rated shows, drawn fainter the less is behind it.
      </P>
      <P>
        People outside your vine have limited impact on your list, which limits
        the effect of bots.
      </P>

      <H2>what others can tell</H2>
      <P>
        Nothing ever shows who rated what. Your list can still hint at what your
        vine liked, and if your vine is one person it is their thumbs.
      </P>

      <P>
        A{" "}
        <a className={link} href={HAFA_URL}>
          hafa.cc
        </a>{" "}
        project, free and open source under the{" "}
        <a className={link} href={REPO_URL}>
          MIT license
        </a>
        .
      </P>
    </DocPage>
  );
}
