import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CustomAnswersList } from "./custom-answers";

describe("CustomAnswersList (INTAKE-Q-1)", () => {
  it("renders each question with the caller's answer", () => {
    render(
      <CustomAnswersList
        payload={{
          custom_answers: [
            { question_id: "q_a", question: "How did you hear about us?", answer: "A friend" },
          ],
        }}
      />,
    );
    expect(screen.getByTestId("custom-answers")).toBeInTheDocument();
    expect(screen.getByText("How did you hear about us?")).toBeInTheDocument();
    expect(screen.getByText("A friend")).toBeInTheDocument();
  });

  it("renders nothing for a payload without answers (safe to drop in unconditionally)", () => {
    const { container } = render(<CustomAnswersList payload={{ reason: "x" }} />);
    expect(container).toBeEmptyDOMElement();
    const view = render(<CustomAnswersList payload={null} />);
    expect(view.container).toBeEmptyDOMElement();
  });

  it("escapes caller-supplied text: markup in an answer is shown as text, never rendered", () => {
    render(
      <CustomAnswersList
        payload={{
          custom_answers: [
            { question_id: "q_a", question: "Notes?", answer: "<img src=x onerror=alert(1)>" },
          ],
        }}
      />,
    );
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("skips malformed entries", () => {
    render(
      <CustomAnswersList
        payload={{
          custom_answers: [
            "junk",
            { question: "", answer: "no question" },
            { question: "Q?", answer: "" },
            { question_id: "q_ok", question: "Real?", answer: "Yes" },
          ],
        }}
      />,
    );
    expect(screen.getAllByText(/Real\?|Yes/)).toHaveLength(2);
    expect(screen.queryByText("no question")).not.toBeInTheDocument();
  });
});
