declare module 'inquirer-autocomplete-prompt' {
  import inquirer from 'inquirer'

  interface AutocompleteOptions extends inquirer.Question {
    type: 'autocomplete'
    source: (answers: any, input: string) => Promise<Array<{ name: string; value: string }>>
    suggestOnly?: boolean
  }

  const autocompletePrompt: inquirer.ui.PromptConstructor
  export default autocompletePrompt
  export { AutocompleteOptions }
}