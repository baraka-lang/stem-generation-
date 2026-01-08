import re
import sys

def remove_console_logs(filepath):
    """Remove console.log and console.warn statements from a JavaScript file."""
    
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    lines = content.split('\n')
    new_lines = []
    i = 0
    removed_count = 0
    
    while i < len(lines):
        line = lines[i]
        stripped = line.lstrip()
        
        # Check if line starts with console.log or console.warn
        if stripped.startswith('console.log(') or stripped.startswith('console.warn('):
            # Count opening and closing parentheses to handle multi-line statements
            open_parens = line.count('(') - line.count(')')
            
            # If statement is complete on one line, skip it
            if open_parens == 0:
                removed_count += 1
                i += 1
                continue
            
            # Otherwise, skip lines until we find the closing parenthesis
            while i < len(lines) - 1 and open_parens > 0:
                i += 1
                open_parens += lines[i].count('(') - lines[i].count(')')
            
            removed_count += 1
            i += 1
            continue
        
        new_lines.append(line)
        i += 1
    
    # Write back to file
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write('\n'.join(new_lines))
    
    print(f"✓ Removed {removed_count} console.log/console.warn statements")
    return removed_count

if __name__ == '__main__':
    if len(sys.argv) > 1:
        filepath = sys.argv[1]
    else:
        filepath = 'src/app.js'
    
    print(f"Processing {filepath}...")
    try:
        count = remove_console_logs(filepath)
    except FileNotFoundError:
        print(f"Error: File {filepath} not found.")
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)
        
    sys.exit(0)
