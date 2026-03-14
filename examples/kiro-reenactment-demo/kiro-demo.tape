# Kiro Reenactment Demo - VHS Recording
#
# Run with: vhs kiro-demo.tape
#
# This creates a GIF showing the Amazon Kiro infrastructure deletion
# incident being prevented by Predicate Authority.

# Configuration
Output kiro-demo.gif
Set FontSize 14
Set Width 1200
Set Height 800
Set Theme "Dracula"
Set Padding 20
Set Framerate 24

# Start with a clean terminal
Hide
Type "cd /Users/guoliangwang/Code/Sentience/openclaw-predicate-provider/examples/kiro-reenactment-demo"
Enter
# Set a clean prompt without username/path
Type "export PS1='$ '"
Enter
Type "clear"
Enter
Sleep 500ms
Show

# Title card
Sleep 1s
Type "# Amazon Kiro Reenactment - Predicate Authority Demo"
Sleep 1.5s
Enter
Sleep 300ms

Type "# An AI agent tries: terraform destroy -auto-approve"
Enter
Sleep 300ms
Type "# Watch Predicate Authority intercept it."
Enter
Sleep 1.5s

# Run the demo with SLOW_MODE for better readability
Type "SLOW_MODE=2 ./run-demo.sh"
Sleep 500ms
Enter

# Wait for the demo to complete (~22s with SLOW_MODE=2)
Sleep 25s

# Give viewer time to read the final summary
Sleep 5s
